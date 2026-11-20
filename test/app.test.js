import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import app from '../src/app.js';
import * as precos from '../src/precos.js';
import { hmacHex } from '../src/util.js';
import { d1, assets } from '../local/ambiente.mjs';

// Mercado Pago e Stripe falsos
const mp = {}; const stripe = {};
const falso = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/v1/payments')) {
      if (req.headers.authorization !== 'Bearer TESTE') { res.statusCode = 401; return res.end('{}'); }
      if (req.method === 'POST') {
        const b = JSON.parse(body); const id = String(Object.keys(mp).length + 1000);
        mp[id] = { id: Number(id), status: 'pending', transaction_amount: b.transaction_amount, external_reference: b.external_reference };
        return res.end(JSON.stringify({ ...mp[id], point_of_interaction: { transaction_data: { qr_code: '00020126PIXFAKE' + id, qr_code_base64: 'iVBORw0KGgo=' } } }));
      }
      const id = req.url.split('/').pop(); return res.end(JSON.stringify(mp[id] || {}));
    }
    if (req.url === '/v1/checkout/sessions' && req.method === 'POST') {
      const f = new URLSearchParams(body); const id = 'cs_test_' + (Object.keys(stripe).length + 1);
      if (stripe.pixOff && [...f.values()].includes('pix')) { res.statusCode = 400; return res.end('{"error":{"message":"pix not activated"}}'); }
      stripe[id] = { id, payment_status: 'unpaid', metadata: { pedido: f.get('metadata[pedido]'), site: f.get('metadata[site]') }, amount: f.get('line_items[0][price_data][unit_amount]') };
      return res.end(JSON.stringify({ ...stripe[id], url: 'https://checkout.stripe.test/' + id }));
    }
    const m = req.url.match(/^\/v1\/checkout\/sessions\/(.+)$/);
    if (m) return res.end(JSON.stringify(stripe[m[1]]));
    res.statusCode = 404; res.end('{}');
  });
});

let env;
const chamar = (path, opts = {}) => app.fetch(new Request('https://ternura.test' + path, { redirect: 'manual', ...opts }), env);
const postJson = (path, d) => chamar(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) });
const auth = { Authorization: 'Basic ' + btoa('admin:segredo'), 'content-type': 'application/x-www-form-urlencoded' };

test.before(async () => {
  await new Promise((r) => falso.listen(0, r));
  const base = `http://localhost:${falso.address().port}`;
  env = { DB: d1(), ASSETS: assets, ADMIN_PASSWORD: 'segredo', STRIPE_METHODS: 'card,pix', STRIPE_SECRET_KEY: 'sk_test', STRIPE_API_BASE: base, STRIPE_WEBHOOK_SECRET: 'whsec_x' };
});
test.after(() => falso.close());

test('preços: template mais barato, extras somam, entrada 50%', () => {
  const t = precos.calcular({ servico: 'site', modelo: 'template', estilo: 'minimalista' });
  assert.ok(t.total < precos.calcular({ servico: 'site', modelo: 'personalizado', estilo: 'minimalista' }).total);
  const e = precos.calcular({ servico: 'site', modelo: 'template', estilo: 'minimalista', extras: { blog: 1, paginas: 2, push: 1 } });
  assert.strictEqual(e.total, 290 + 190 + 180); // push não vale para site
  assert.strictEqual(e.agora, e.total / 2);
  const v = precos.calcular({ servico: 'site', modelo: 'template', estilo: 'minimalista', pagamento: 'total' });
  assert.strictEqual(v.total, 290 - Math.round(290 * 0.05)); assert.strictEqual(v.agora, v.total);
  assert.strictEqual(precos.calcular({ servico: 'social', pagamento: 'entrada' }).pagamento, 'total');
  assert.throws(() => precos.calcular({ servico: 'nada' }));
});

test('cartão: checkout Stripe, retorno pago e webhook assinado', async () => {
  const d = await (await postJson('/api/pedido', { config: { servico: 'site', modelo: 'template', estilo: 'minimalista' }, cliente: { nome: 'Bia', email: 'bia@x.com', whatsapp: '62999990000' } })).json();
  const token = d.url.split('/').pop();
  assert.match(await (await chamar(`/pagar/${token}`)).text(), /Pix ou cartão/);
  const r = await chamar(`/pagar/${token}/stripe`, { method: 'POST' });
  assert.strictEqual(r.status, 303); assert.match(r.headers.get('location'), /checkout\.stripe\.test/);
  const sid = Object.keys(stripe).at(-1);
  assert.strictEqual(stripe[sid].amount, String(Math.round(precos.calcular({ servico: 'site', modelo: 'template', estilo: 'minimalista' }).agora * 100)));
  // retorno sem pagar não marca
  assert.doesNotMatch(await (await chamar(`/pagar/${token}?session_id=${sid}`)).text(), /Pagamento confirmado/);
  stripe[sid].payment_status = 'paid';
  assert.match(await (await chamar(`/pagar/${token}?session_id=${sid}`)).text(), /Pagamento confirmado/);

  // webhook: assinatura errada é recusada, certa marca outro pedido
  const d2 = await (await postJson('/api/pedido', { config: { servico: 'site' }, cliente: { nome: 'Cris', email: 'c@x.com', whatsapp: '62999990000' } })).json();
  const t2 = d2.url.split('/').pop();
  const id2 = (await env.DB.prepare('SELECT id FROM pedidos WHERE token = ?').bind(t2).first()).id;
  const corpo = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_x', payment_status: 'paid', metadata: { pedido: id2, site: 'ternura' } } } });
  const ts = Math.floor(Date.now() / 1000);
  assert.strictEqual((await chamar('/webhook/stripe', { method: 'POST', body: corpo, headers: { 'stripe-signature': `t=${ts},v1=errado` } })).status, 400);
  const sig = await hmacHex('whsec_x', `${ts}.${corpo}`);
  assert.strictEqual((await chamar('/webhook/stripe', { method: 'POST', body: corpo, headers: { 'stripe-signature': `t=${ts},v1=${sig}` } })).status, 200);
  assert.strictEqual((await (await chamar(`/api/status/${t2}`)).json()).status, 'pago');
});

test('pedido sob consulta: painel define valor e marca pago', async () => {
  const { id } = await (await postJson('/api/orcamento', { nome: 'Duda', email: 'd@x.com', whatsapp: '(62) 99999-0000', descricao: 'Quero um sistema' })).json();
  assert.strictEqual((await chamar('/admin')).status, 401);
  assert.strictEqual((await chamar('/admin', { headers: { Authorization: 'Basic ' + btoa('admin:errada') } })).status, 401);
  assert.strictEqual((await chamar(`/admin/${id}`, { method: 'POST', headers: auth, body: 'titulo=Sistema&proposta=Tudo&valor=1500' })).status, 302);
  const token = (await env.DB.prepare('SELECT token FROM pedidos WHERE id = ?').bind(id).first()).token;
  assert.match(await (await chamar(`/pagar/${token}`)).text(), /R\$ 1\.500,00/);
  await chamar(`/admin/${id}/status`, { method: 'POST', headers: auth, body: 'status=pago' });
  assert.match(await (await chamar(`/pagar/${token}`)).text(), /Pagamento confirmado/);
  assert.match(await (await chamar('/admin', { headers: auth })).text(), /Duda/);
});

test('páginas e exemplos respondem', async () => {
  for (const p of ['/', '/orcamento', '/api/catalogo', '/config.json', '/exemplos/blast/', '/exemplos/underground/', '/exemplos/doce-nuvem/', '/exemplos/social/', '/exemplos/social/img/01.jpg', '/exemplos/lia-moreno/', '/exemplos/sereno/', '/exemplos/folha/', '/img/logo.png']) {
    assert.strictEqual((await chamar(p)).status, 200, p);
  }
});

test('sem WhatsApp o pedido é recusado; Pix desativado cai pro cartão', async () => {
  assert.strictEqual((await postJson('/api/pedido', { config: { servico: 'site' }, cliente: { nome: 'E', email: 'e@x.com' } })).status, 400);
  const d = await (await postJson('/api/pedido', { config: { servico: 'site' }, cliente: { nome: 'E', email: 'e@x.com', whatsapp: '62999990000' } })).json();
  Object.defineProperty(stripe, 'pixOff', { value: true, enumerable: false, configurable: true });
  const r = await chamar(`/pagar/${d.url.split('/').pop()}/stripe`, { method: 'POST' });
  delete stripe.pixOff;
  assert.strictEqual(r.status, 303); assert.match(r.headers.get('location'), /checkout\.stripe\.test/);
  const html = await (await chamar('/')).text();
  assert.doesNotMatch(html, /wa\.me|ywwsmim|yasmimgborba/);
});
