const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const os = require('os'); const path = require('path'); const fs = require('fs');

// Mercado Pago falso
let mpPagamentos = {};
const mpFake = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer TESTE') { res.statusCode = 401; return res.end('{"message":"unauthorized"}'); }
    if (req.method === 'POST' && req.url === '/v1/payments') {
      const b = JSON.parse(body); const id = String(Object.keys(mpPagamentos).length + 1000);
      mpPagamentos[id] = { id: Number(id), status: 'pending', transaction_amount: b.transaction_amount, external_reference: b.external_reference };
      return res.end(JSON.stringify({ ...mpPagamentos[id], point_of_interaction: { transaction_data: { qr_code: '00020126PIXFAKE' + id, qr_code_base64: 'iVBORw0KGgo=' } } }));
    }
    const m = req.url.match(/^\/v1\/payments\/(\d+)$/);
    if (m && mpPagamentos[m[1]]) return res.end(JSON.stringify(mpPagamentos[m[1]]));
    res.statusCode = 404; res.end('{}');
  });
});

process.env.DB_FILE = path.join(os.tmpdir(), `ternura-test-${process.pid}.json`);
process.env.ADMIN_PASSWORD = 'segredo';
process.env.MP_ACCESS_TOKEN = 'TESTE';
const { buildPixPayload, crc16 } = require('../src/pix');
const precos = require('../src/precos');
const app = require('../server');

let base, srv;
test.before(async () => {
  await new Promise((r) => mpFake.listen(0, r));
  process.env.MP_API_BASE = `http://localhost:${mpFake.address().port}`;
  srv = app.listen(0); base = `http://localhost:${srv.address().port}`;
});
test.after(() => { srv.close(); mpFake.close(); fs.rmSync(process.env.DB_FILE, { force: true }); });

test('CRC16 do Pix bate com o valor de referência', () => {
  assert.strictEqual(crc16('123456789'), '29B1');
  const p = buildPixPayload({ key: 'a@b.com', name: 'José', city: 'São Paulo', amount: 150, txid: 'PED1' });
  assert.match(p, /5406150\.00/); assert.strictEqual(p.slice(-4), crc16(p.slice(0, -4)));
});

test('preços: template é mais barato, extras somam, entrada é 50%', () => {
  const t = precos.calcular({ servico: 'site', modelo: 'template', estilo: 'minimalista' });
  const p = precos.calcular({ servico: 'site', modelo: 'personalizado', estilo: 'minimalista' });
  assert.ok(t.total < p.total);
  const e = precos.calcular({ servico: 'site', modelo: 'template', estilo: 'minimalista', extras: { blog: 1, paginas: 2, push: 1 } });
  assert.strictEqual(e.total, 290 + 190 + 180); // push não vale para site
  assert.strictEqual(e.agora, e.total / 2);
  const v = precos.calcular({ servico: 'site', modelo: 'template', estilo: 'minimalista', pagamento: 'total' });
  assert.strictEqual(v.total, 290 - Math.round(290 * 0.05)); assert.strictEqual(v.agora, v.total);
  const s = precos.calcular({ servico: 'social', modelo: 'template', estilo: 'fofo', pagamento: 'entrada' });
  assert.strictEqual(s.agora, s.total); // mensal cobra o mês inteiro
  assert.throws(() => precos.calcular({ servico: 'nada' }));
  assert.ok(precos.calcular({ servico: 'site', extras: { paginas: 9999 } }).itens.find((i) => i.nome.includes('20x')));
});

test('configurador: pedido -> Pix do Mercado Pago -> webhook aprova -> pago', async () => {
  let r = await fetch(base + '/api/pedido', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: { servico: 'design', modelo: 'template', estilo: 'fofo', paleta: 'ternura', cores: ['#8AD0BB', 'x'] }, cliente: { nome: 'Ana', email: 'ana@x.com' } }) });
  const d = await r.json(); assert.ok(d.ok, d.erro);
  const token = d.url.split('/').pop();
  const html = await (await fetch(base + d.url)).text();
  assert.match(html, /PIXFAKE/); assert.match(html, /Design gráfico/);
  // valor cobrado = calculado no servidor (não confia no navegador)
  const pid = Object.keys(mpPagamentos)[0];
  assert.strictEqual(mpPagamentos[pid].transaction_amount, precos.calcular({ servico: 'design', modelo: 'template', estilo: 'fofo' }).agora);
  // recarregar não cria outro Pix
  await fetch(base + d.url); assert.strictEqual(Object.keys(mpPagamentos).length, 1);

  // webhook com pagamento ainda pendente não marca
  await fetch(base + '/webhook/mercadopago', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'payment', data: { id: pid } }) });
  assert.strictEqual((await (await fetch(`${base}/api/status/${token}`)).json()).status, 'orcado');
  mpPagamentos[pid].status = 'approved';
  r = await fetch(base + '/webhook/mercadopago', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'payment', data: { id: pid } }) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await (await fetch(`${base}/api/status/${token}`)).json()).status, 'pago');
  assert.match(await (await fetch(base + d.url)).text(), /Pagamento confirmado/);
});

test('pedido planejado: admin define valor e marca como pago', async () => {
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:segredo').toString('base64') };
  let r = await fetch(base + '/api/orcamento', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Bia', email: 'bia@x.com', descricao: 'Quero um sistema' }) });
  const { id } = await r.json();
  assert.strictEqual((await fetch(base + '/admin')).status, 401);
  r = await fetch(`${base}/admin/${id}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'titulo=Sistema&proposta=Tudo&valor=1500', redirect: 'manual' });
  assert.strictEqual(r.status, 302);
  const token = require('../src/db').findById(id).token;
  assert.match(await (await fetch(`${base}/pagar/${token}`)).text(), /R\$\s?1\.500,00/);
  await fetch(`${base}/admin/${id}/status`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'status=pago', redirect: 'manual' });
  assert.match(await (await fetch(`${base}/pagar/${token}`)).text(), /Pagamento confirmado/);
});

test('páginas públicas e exemplos respondem', async () => {
  for (const p of ['/', '/orcamento', '/api/catalogo', '/exemplos/blast/', '/exemplos/underground/', '/exemplos/doce-nuvem/', '/exemplos/lia-moreno/', '/exemplos/sereno/', '/exemplos/folha/']) {
    assert.strictEqual((await fetch(base + p)).status, 200, p);
  }
});
