require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('./src/db');
const precos = require('./src/precos');
const mp = require('./src/mercadopago');
const { buildPixPayload } = require('./src/pix');

const cfg = {
  brand: process.env.BRAND_NAME || 'Ternura',
  email: process.env.CONTACT_EMAIL || '',
  whatsapp: (process.env.WHATSAPP || '').replace(/\D/g, ''),
  instagram: (process.env.INSTAGRAM || '').replace(/^@/, ''),
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  pixKey: process.env.PIX_KEY || '',
  pixName: process.env.PIX_NAME || '',
  pixCity: process.env.PIX_CITY || '',
  stripeMethods: (process.env.STRIPE_METHODS || 'card').split(',').map((s) => s.trim()).filter(Boolean),
};

const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const app = express();
app.disable('x-powered-by');

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS = { novo: 'Novo', orcado: 'Aguardando pagamento', pago: 'Pago', cancelado: 'Cancelado' };
const cut = (v, n) => String(v ?? '').slice(0, n);
const primeiroNome = (n) => String(n || '').split(' ')[0];

function page(title, body, { admin = false } = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(cfg.brand)}</title>
<link rel="icon" href="/img/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/ternura.css"></head>
<body class="inner"><header class="topo"><div class="topo-in"><a class="marca" href="/"><i></i>${esc(cfg.brand)}</a>
${admin ? '<nav class="menu"><a href="/admin">Pedidos</a></nav>' : '<nav class="menu"><a href="/#portfolio">Portfólio</a><a class="btn sm" href="/orcamento">Fazer orçamento</a></nav>'}</div></header>
<main class="wrap estreito">${body}</main></body></html>`;
}

function marcarPago(id, extra) {
  const p = db.findById(id);
  if (!p || p.status === 'pago') return p;
  return db.update(id, { status: 'pago', pagoEm: new Date().toISOString(), ...extra });
}

// ---------- webhooks (precisam vir antes do express.json) ----------
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe) return res.sendStatus(400);
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    const s = event.data.object;
    if (s.payment_status === 'paid' && s.metadata?.pedido) marcarPago(s.metadata.pedido, { pagoVia: 'stripe', stripeSession: s.id });
  }
  res.json({ received: true });
});

app.post('/webhook/mercadopago', express.json(), async (req, res) => {
  const id = req.body?.data?.id || req.query['data.id'] || req.query.id;
  const tipo = req.body?.type || req.query.type || req.query.topic;
  if (!id || (tipo && tipo !== 'payment')) return res.sendStatus(200);
  if (!mp.assinaturaValida(req.headers, id)) return res.sendStatus(401);
  try {
    const pay = await mp.consultar(id); // nunca confia no corpo: consulta direto no Mercado Pago
    if (pay.status === 'approved' && pay.external_reference) {
      const p = db.findById(pay.external_reference);
      if (p && Math.abs(Number(pay.transaction_amount) - Number(p.valor)) < 0.01) {
        marcarPago(p.id, { pagoVia: 'pix-mercadopago', mpPagamento: String(pay.id) });
      }
    }
  } catch (err) {
    console.error('Webhook MP:', err.message);
    return res.sendStatus(500);
  }
  res.sendStatus(200);
});

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false }));

// ---------- site público ----------
app.get('/config.json', (req, res) =>
  res.json({ brand: cfg.brand, email: cfg.email, whatsapp: cfg.whatsapp, instagram: cfg.instagram }));
app.get('/api/catalogo', (req, res) => {
  const { servicos, modelos, estilos, paletas, extras, urgencias, pagamentos } = precos;
  res.json({ servicos, modelos, estilos, paletas, extras, urgencias, pagamentos });
});
app.post('/api/calcular', (req, res) => {
  try { res.json({ ok: true, ...precos.calcular(req.body) }); }
  catch (e) { res.status(400).json({ ok: false, erro: e.message }); }
});
app.get('/orcamento', (req, res) => res.sendFile(__dirname + '/public/orcamento.html'));
app.use(express.static('public', { extensions: ['html'] }));

function validarCliente(c = {}) {
  if (!c.nome || !c.email) return 'Preencha nome e e-mail.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return 'E-mail inválido.';
  return null;
}

// Pedido "planejado": sem valor, você responde pelo painel.
app.post('/api/orcamento', (req, res) => {
  const b = req.body || {};
  if (b.site) return res.json({ ok: true });
  const erro = validarCliente(b) || (!b.descricao && 'Conte um pouco da sua ideia.');
  if (erro) return res.status(400).json({ ok: false, erro });
  const p = db.create({
    origem: 'contato', nome: cut(b.nome, 120), email: cut(b.email, 160), whatsapp: cut(b.whatsapp, 40),
    tipo: cut(b.tipo, 60), faixa: cut(b.orcamento, 60), prazo: cut(b.prazo, 60), descricao: cut(b.descricao, 4000),
  });
  res.json({ ok: true, id: p.id });
});

// Pedido do configurador: preço calculado aqui e link de pagamento na hora.
app.post('/api/pedido', (req, res) => {
  const { config = {}, cliente = {}, site } = req.body || {};
  if (site) return res.json({ ok: true });
  const erro = validarCliente(cliente);
  if (erro) return res.status(400).json({ ok: false, erro });
  let calc;
  try { calc = precos.calcular(config); } catch (e) { return res.status(400).json({ ok: false, erro: e.message }); }

  const paleta = precos.paletas[config.paleta] ? config.paleta : 'personalizada';
  const cores = (Array.isArray(config.cores) ? config.cores : []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 4);
  const p = db.create({
    origem: 'configurador', status: 'orcado',
    nome: cut(cliente.nome, 120), email: cut(cliente.email, 160), whatsapp: cut(cliente.whatsapp, 40),
    negocio: cut(cliente.negocio, 80), descricao: cut(cliente.obs, 3000),
    tipo: precos.servicos[calc.servico].nome, titulo: calc.titulo, itens: calc.itens, total: calc.total,
    valor: calc.agora, pagamento: calc.pagamento, mensal: calc.mensal, prazo: calc.prazo,
    escolhas: { ...calc, itens: undefined, paleta, cores },
  });
  res.json({ ok: true, id: p.id, url: `/pagar/${p.token}` });
});

app.get('/api/status/:token', async (req, res) => {
  let p = db.findByToken(req.params.token);
  if (!p) return res.status(404).json({ status: 'inexistente' });
  // Sem webhook (ex.: testando no computador)? Consulta o Mercado Pago de vez em quando.
  if (p.status === 'orcado' && p.mp?.id && mp.ativo() && Date.now() - (p.mp.checado || 0) > 8000) {
    db.update(p.id, { mp: { ...p.mp, checado: Date.now() } });
    try {
      const pay = await mp.consultar(p.mp.id);
      if (pay.status === 'approved') p = marcarPago(p.id, { pagoVia: 'pix-mercadopago', mpPagamento: String(pay.id) });
    } catch (e) { console.error('Status MP:', e.message); }
  }
  res.json({ status: p.status });
});

async function pixDoPedido(p) {
  if (mp.ativo()) {
    const ok = p.mp && p.mp.valor === p.valor && new Date(p.mp.expira) - Date.now() > 30 * 60 * 1000;
    if (ok) return p.mp;
    const pix = await mp.criarPix({
      pedido: p.id, valor: p.valor, descricao: `${cfg.brand} · pedido #${p.id}`, email: p.email, nome: p.nome,
      notificationUrl: `${cfg.baseUrl}/webhook/mercadopago`,
    });
    const salvo = { ...pix, valor: p.valor };
    db.update(p.id, { mp: salvo });
    return salvo;
  }
  if (cfg.pixKey) {
    const copiaECola = buildPixPayload({ key: cfg.pixKey, name: cfg.pixName, city: cfg.pixCity, amount: p.valor, txid: 'PED' + p.id });
    return { copiaECola, estatico: true };
  }
  return null;
}

app.get('/pagar/:token', async (req, res) => {
  const p = db.findByToken(req.params.token);
  if (!p || p.status === 'novo' || p.status === 'cancelado') {
    return res.status(404).send(page('Não encontrado', '<div class="cartao centro"><h1>Link inválido</h1><p>Esse orçamento não existe ou ainda não foi liberado.</p></div>'));
  }
  if (p.status === 'pago') {
    return res.send(page('Pago', `<div class="cartao centro"><div class="icone-ok">✓</div><h1>Pagamento confirmado!</h1>
      <p>Obrigada, ${esc(primeiroNome(p.nome))}! O pedido <b>#${p.id}</b> está pago. Em até 1 dia útil você recebe uma mensagem pra gente começar.</p>
      <a class="btn" href="/">Voltar ao site</a></div>`));
  }

  let pix = null, pixErro = false;
  try { pix = await pixDoPedido(p); } catch (e) { console.error('Pix:', e.message); pixErro = true; }

  let blocoPix = '';
  if (pix) {
    const qr = pix.qrBase64 ? `data:image/png;base64,${pix.qrBase64}` : await QRCode.toDataURL(pix.copiaECola, { margin: 1, width: 260 });
    blocoPix = `<div class="opcao-pag"><h3>Pix</h3><p class="suave">${pix.estatico ? 'Escaneie ou copie o código.' : 'Aprovação na hora, confirmado automaticamente.'}</p>
      <img class="qr" src="${qr}" alt="QR Code Pix">
      <textarea id="pix" readonly>${esc(pix.copiaECola)}</textarea>
      <button class="btn contorno" type="button" onclick="navigator.clipboard.writeText(document.getElementById('pix').value);this.textContent='Copiado'">Copiar Pix copia e cola</button>
      ${pix.estatico
        ? `<p class="suave peq">Depois de pagar, mande o comprovante${cfg.whatsapp ? ` no <a href="https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent('Comprovante do pedido #' + p.id)}">WhatsApp</a>` : ''}.</p>`
        : '<p class="suave peq" id="aguardando">Esperando o pagamento… esta página atualiza sozinha.</p>'}</div>`;
  } else if (pixErro) {
    blocoPix = '<div class="opcao-pag"><h3>Pix</h3><p class="suave">O Pix está instável agora. Tente de novo em alguns minutos ou pague no cartão.</p></div>';
  }
  const blocoCartao = stripe
    ? `<div class="opcao-pag"><h3>Cartão de crédito</h3><p class="suave">Pagamento seguro pela Stripe${cfg.stripeMethods.length > 1 ? ' (cartão ou Pix)' : ''}.</p>
      <form method="post" action="/pagar/${esc(p.token)}/stripe"><button class="btn">Pagar ${brl(p.valor)} no cartão</button></form></div>`
    : '';

  const itens = (p.itens || []).map((i) => `<li><span>${esc(i.nome)}</span><b>${brl(i.valor)}</b></li>`).join('');
  const resumo = p.itens
    ? `<ul class="itens">${itens}</ul>
       <div class="total"><span>Total do projeto${p.mensal ? ' (por mês)' : ''}</span><strong>${brl(p.total)}</strong></div>
       ${p.valor !== p.total ? `<div class="total agora"><span>Entrada agora (50%)</span><strong>${brl(p.valor)}</strong></div>` : ''}
       ${p.prazo ? `<p class="suave peq">Prazo estimado: ${esc(p.prazo)}, contado depois do pagamento e do briefing.</p>` : ''}`
    : `<p class="pre">${esc(p.proposta || '')}</p><div class="total"><span>Total</span><strong>${brl(p.valor)}</strong></div>`;

  res.send(page(`Pedido #${p.id}`, `
    <p class="sobretitulo">Orçamento #${p.id}</p>
    <h1>${esc(p.titulo || 'Seu projeto')}</h1>
    ${p.negocio ? `<p class="suave">Para <b>${esc(p.negocio)}</b></p>` : ''}
    <div class="cartao">${resumo}</div>
    <h2>Como você quer pagar?</h2>
    <div class="grade-pag">${blocoPix}${blocoCartao}</div>
    ${!blocoPix && !blocoCartao ? '<p>Formas de pagamento ainda não configuradas.</p>' : ''}
    ${cfg.whatsapp || cfg.email ? `<p class="suave peq centro">Dúvidas? ${cfg.whatsapp ? `<a href="https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent('Oi! Tenho uma dúvida sobre o pedido #' + p.id)}">Fale comigo no WhatsApp</a>` : `<a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a>`}</p>` : ''}
    ${pix && !pix.estatico ? `<script>
      setInterval(async () => { try { const r = await fetch('/api/status/${p.token}'); const d = await r.json(); if (d.status === 'pago') location.reload(); } catch {} }, 5000);
    </script>` : ''}`));
});

app.post('/pagar/:token/stripe', async (req, res) => {
  const p = db.findByToken(req.params.token);
  if (!p || p.status !== 'orcado' || !stripe) return res.redirect(`/pagar/${req.params.token}`);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: cfg.stripeMethods,
      customer_email: p.email,
      line_items: [{
        quantity: 1,
        price_data: { currency: 'brl', unit_amount: Math.round(p.valor * 100), product_data: { name: `${p.titulo || 'Projeto'} (#${p.id})` } },
      }],
      payment_method_options: process.env.STRIPE_PARCELAS === '1' && cfg.stripeMethods.includes('card') ? { card: { installments: { enabled: true } } } : undefined,
      metadata: { pedido: p.id },
      success_url: `${cfg.baseUrl}/pagar/${p.token}?ok=1`,
      cancel_url: `${cfg.baseUrl}/pagar/${p.token}`,
    });
    res.redirect(303, session.url);
  } catch (err) {
    console.error('Stripe:', err.message);
    res.status(500).send(page('Erro', '<div class="cartao centro"><h1>Ops</h1><p>Não deu pra abrir o pagamento no cartão agora. Tente o Pix ou fale comigo.</p></div>'));
  }
});

// ---------- painel admin ----------
function auth(req, res, next) {
  if (!cfg.adminPassword) return res.status(503).send('Defina ADMIN_PASSWORD no .env');
  const [user, pass] = Buffer.from((req.headers.authorization || '').split(' ')[1] || '', 'base64').toString().split(':');
  const ok = user === 'admin' && pass &&
    crypto.timingSafeEqual(crypto.createHash('sha256').update(pass).digest(), crypto.createHash('sha256').update(cfg.adminPassword).digest());
  if (ok) return next();
  res.set('WWW-Authenticate', 'Basic realm="admin"').status(401).send('Acesso restrito');
}

app.get('/admin', auth, (req, res) => {
  const pedidos = db.list();
  const rows = pedidos.map((p) => `<a class="linha" href="/admin/${p.id}">
      <span><b>#${p.id}</b> ${esc(p.nome)}${p.negocio ? ` · ${esc(p.negocio)}` : ''}<br><span class="suave peq">${esc(p.tipo || '')} · ${p.origem === 'configurador' ? 'configurador' : 'pedido planejado'} · ${new Date(p.criadoEm).toLocaleDateString('pt-BR')}</span></span>
      <span>${p.valor ? brl(p.valor) : ''} <span class="etiqueta ${p.status}">${STATUS[p.status]}</span></span></a>`).join('');
  const recebido = pedidos.filter((p) => p.status === 'pago').reduce((s, p) => s + Number(p.valor || 0), 0);
  res.send(page('Painel', `<h1>Pedidos</h1><p class="suave">${pedidos.length} pedidos · ${brl(recebido)} recebidos</p>
    <div class="lista">${rows || '<p class="suave">Nenhum pedido ainda.</p>'}</div>`, { admin: true }));
});

app.get('/admin/:id', auth, (req, res) => {
  const p = db.findById(req.params.id);
  if (!p) return res.redirect('/admin');
  const link = `${cfg.baseUrl}/pagar/${p.token}`;
  const e = p.escolhas;
  const escolhas = e ? `<p><b>Serviço:</b> ${esc(p.tipo)} · <b>Modelo:</b> ${esc(precos.modelos[e.modelo]?.nome)} · <b>Estilo:</b> ${esc(precos.estilos[e.estilo]?.nome)}<br>
      <b>Cores:</b> ${(e.cores || []).map((c) => `<span class="amostra" style="background:${esc(c)}"></span>${esc(c)}`).join(' ')}<br>
      <b>Itens:</b> ${(p.itens || []).map((i) => esc(i.nome)).join(', ')}<br>
      <b>Pagamento:</b> ${esc(precos.pagamentos[p.pagamento]?.nome || '')} · <b>Total:</b> ${brl(p.total)} · <b>Prazo:</b> ${esc(p.prazo)}</p>` : '';
  res.send(page(`#${p.id}`, `<p><a href="/admin">← Pedidos</a></p>
    <h1>#${p.id} · ${esc(p.nome)} <span class="etiqueta ${p.status}">${STATUS[p.status]}</span></h1>
    <div class="cartao"><p><b>E-mail:</b> <a href="mailto:${esc(p.email)}">${esc(p.email)}</a><br>
      <b>WhatsApp:</b> ${esc(p.whatsapp || '—')}${p.negocio ? `<br><b>Negócio:</b> ${esc(p.negocio)}` : ''}
      ${p.faixa ? `<br><b>Faixa:</b> ${esc(p.faixa)} · <b>Prazo:</b> ${esc(p.prazo || '—')}` : ''}</p>
      ${escolhas}
      ${p.descricao ? `<p class="pre">${esc(p.descricao)}</p>` : ''}
      ${p.pagoVia ? `<p><b>Pago via:</b> ${esc(p.pagoVia)} em ${new Date(p.pagoEm).toLocaleString('pt-BR')}</p>` : ''}</div>
    ${p.origem !== 'configurador' && p.status !== 'pago' ? `<h2>Enviar orçamento</h2>
    <form class="cartao formulario" method="post" action="/admin/${p.id}">
      <label>Título<input name="titulo" value="${esc(p.titulo || '')}" placeholder="Ex.: Loja virtual completa" required></label>
      <label>Proposta (o que está incluso)<textarea name="proposta" rows="6" required>${esc(p.proposta || '')}</textarea></label>
      <label>Valor a cobrar agora (R$)<input name="valor" type="number" step="0.01" min="1" value="${esc(p.valor || '')}" required></label>
      <button class="btn">${p.status === 'novo' ? 'Gerar link de pagamento' : 'Atualizar orçamento'}</button>
    </form>` : ''}
    ${p.status !== 'novo' ? `<div class="cartao"><p><b>Link de pagamento do cliente:</b></p><input readonly value="${esc(link)}" onclick="this.select()">
      <p class="acoes"><a class="btn contorno" target="_blank" href="${esc(link)}">Abrir</a>
      ${p.whatsapp ? `<a class="btn contorno" target="_blank" href="https://wa.me/${esc(p.whatsapp.replace(/\D/g, ''))}?text=${encodeURIComponent(`Oi ${primeiroNome(p.nome)}! Seu orçamento está pronto: ${link}`)}">Enviar no WhatsApp</a>` : ''}</p></div>` : ''}
    <form method="post" action="/admin/${p.id}/status" class="acoes">
      ${p.status !== 'pago' ? '<button class="btn contorno" name="status" value="pago">Marcar como pago</button>' : ''}
      ${p.status !== 'cancelado' ? '<button class="btn contorno perigo" name="status" value="cancelado">Cancelar</button>' : ''}
    </form>`, { admin: true }));
});

app.post('/admin/:id', auth, (req, res) => {
  const valor = Number(String(req.body.valor).replace(',', '.'));
  const p = db.findById(req.params.id);
  if (!p || p.status === 'pago' || !(valor > 0)) return res.redirect(`/admin/${req.params.id}`);
  db.update(p.id, { titulo: cut(req.body.titulo, 120), proposta: cut(req.body.proposta, 5000), valor, total: valor, status: 'orcado' });
  res.redirect(`/admin/${p.id}`);
});

app.post('/admin/:id/status', auth, (req, res) => {
  const status = req.body.status;
  if (status === 'pago') marcarPago(req.params.id, { pagoVia: 'manual' });
  if (status === 'cancelado') db.update(req.params.id, { status });
  res.redirect(`/admin/${req.params.id}`);
});

const port = process.env.PORT || 3000;
if (require.main === module) app.listen(port, () => console.log(`${cfg.brand} rodando em http://localhost:${port}`));
module.exports = app;
