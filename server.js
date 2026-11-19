require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('./src/db');
const { buildPixPayload } = require('./src/pix');

const cfg = {
  brand: process.env.BRAND_NAME || 'Ternura Studio',
  email: process.env.CONTACT_EMAIL || '',
  whatsapp: process.env.WHATSAPP || '',
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  pixKey: process.env.PIX_KEY || '',
  pixName: process.env.PIX_NAME || '',
  pixCity: process.env.PIX_CITY || '',
  stripeMethods: (process.env.STRIPE_METHODS || 'card').split(',').map((s) => s.trim()).filter(Boolean),
};

const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const app = express();

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS = { novo: 'Novo', orcado: 'Orçado', pago: 'Pago', cancelado: 'Cancelado' };

function page(title, body) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(cfg.brand)}</title>
<link rel="stylesheet" href="/style.css"></head>
<body class="inner"><header class="bar"><a class="logo" href="/">${esc(cfg.brand)}</a></header>
<main class="wrap narrow">${body}</main></body></html>`;
}

// ---------- webhook Stripe (precisa do corpo cru, antes do express.json) ----------
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
    if (s.payment_status === 'paid' && s.metadata?.pedido) {
      db.update(s.metadata.pedido, { status: 'pago', pagoVia: 'stripe', stripeSession: s.id, pagoEm: new Date().toISOString() });
    }
  }
  res.json({ received: true });
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ---------- site público ----------
app.get('/config.json', (req, res) => res.json({ brand: cfg.brand, email: cfg.email, whatsapp: cfg.whatsapp }));
app.use(express.static('public'));

app.post('/api/orcamento', (req, res) => {
  const { nome, email, whatsapp, tipo, orcamento, prazo, descricao, site } = req.body || {};
  if (site) return res.json({ ok: true }); // honeypot anti-spam
  if (!nome || !email || !descricao) return res.status(400).json({ ok: false, erro: 'Preencha nome, e-mail e descrição.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, erro: 'E-mail inválido.' });
  const cut = (v, n) => String(v || '').slice(0, n);
  const p = db.create({
    nome: cut(nome, 120), email: cut(email, 160), whatsapp: cut(whatsapp, 40), tipo: cut(tipo, 60),
    faixa: cut(orcamento, 60), prazo: cut(prazo, 60), descricao: cut(descricao, 4000),
  });
  res.json({ ok: true, id: p.id });
});

// Página de pagamento do cliente
app.get('/pagar/:token', async (req, res) => {
  const p = db.findByToken(req.params.token);
  if (!p || p.status === 'novo' || p.status === 'cancelado') {
    return res.status(404).send(page('Não encontrado', '<h1>Link inválido</h1><p>Esse orçamento não existe ou ainda não foi liberado.</p>'));
  }
  if (p.status === 'pago') {
    return res.send(page('Pago', `<div class="card center"><div class="ok-icon">✓</div><h1>Pagamento confirmado</h1>
      <p>Obrigada, ${esc(p.nome.split(' ')[0])}! Pedido <b>#${p.id}</b> está pago. Vamos começar 🚀</p></div>`));
  }

  let pix = '';
  if (cfg.pixKey) {
    const code = buildPixPayload({ key: cfg.pixKey, name: cfg.pixName, city: cfg.pixCity, amount: p.valor, txid: 'PED' + p.id });
    const qr = await QRCode.toDataURL(code, { margin: 1, width: 260 });
    pix = `<div class="pay-opt"><h3>Pix</h3><p class="muted">Sem taxa. Escaneie ou copie o código.</p>
      <img class="qr" src="${qr}" alt="QR Code Pix">
      <textarea id="pix" readonly>${esc(code)}</textarea>
      <button class="btn ghost" onclick="navigator.clipboard.writeText(document.getElementById('pix').value);this.textContent='Copiado!'">Copiar código Pix</button>
      <p class="muted small">Depois de pagar, envie o comprovante${cfg.whatsapp ? ` no <a href="https://wa.me/${esc(cfg.whatsapp)}?text=${encodeURIComponent('Comprovante do pedido #' + p.id)}">WhatsApp</a>` : ''}.</p></div>`;
  }
  const card = stripe
    ? `<div class="pay-opt"><h3>Cartão${cfg.stripeMethods.includes('pix') ? ' ou Pix automático' : ''}</h3>
      <p class="muted">Pagamento seguro pela Stripe.</p>
      <form method="post" action="/pagar/${esc(p.token)}/stripe"><button class="btn">Pagar ${brl(p.valor)}</button></form></div>`
    : '';

  res.send(page(`Pedido #${p.id}`, `
    <p class="eyebrow">Orçamento #${p.id}</p>
    <h1>${esc(p.titulo || 'Seu projeto')}</h1>
    <div class="card"><p class="pre">${esc(p.proposta || '')}</p>
      <div class="total"><span>Total</span><strong>${brl(p.valor)}</strong></div></div>
    <h2>Como você quer pagar?</h2>
    <div class="pay-grid">${card}${pix}</div>
    ${!card && !pix ? '<p>Formas de pagamento ainda não configuradas.</p>' : ''}`));
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
      metadata: { pedido: p.id },
      success_url: `${cfg.baseUrl}/pagar/${p.token}?ok=1`,
      cancel_url: `${cfg.baseUrl}/pagar/${p.token}`,
    });
    res.redirect(303, session.url);
  } catch (err) {
    console.error('Stripe:', err.message);
    res.status(500).send(page('Erro', `<h1>Ops</h1><p>Não deu para abrir o pagamento agora. Tente o Pix ou fale com a gente.</p>`));
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
  const rows = pedidos.map((p) => `<a class="row" href="/admin/${p.id}">
      <span><b>#${p.id}</b> ${esc(p.nome)}<br><span class="muted small">${esc(p.tipo || '')} · ${new Date(p.criadoEm).toLocaleDateString('pt-BR')}</span></span>
      <span>${p.valor ? brl(p.valor) : ''} <span class="tag ${p.status}">${STATUS[p.status]}</span></span></a>`).join('');
  const total = pedidos.filter((p) => p.status === 'pago').reduce((s, p) => s + Number(p.valor || 0), 0);
  res.send(page('Painel', `<h1>Pedidos</h1><p class="muted">${pedidos.length} pedidos · ${brl(total)} recebidos</p>
    <div class="list">${rows || '<p class="muted">Nenhum pedido ainda.</p>'}</div>`));
});

app.get('/admin/:id', auth, (req, res) => {
  const p = db.findById(req.params.id);
  if (!p) return res.redirect('/admin');
  const link = `${cfg.baseUrl}/pagar/${p.token}`;
  res.send(page(`#${p.id}`, `<p><a href="/admin">← Pedidos</a></p>
    <h1>#${p.id} · ${esc(p.nome)} <span class="tag ${p.status}">${STATUS[p.status]}</span></h1>
    <div class="card"><p><b>E-mail:</b> <a href="mailto:${esc(p.email)}">${esc(p.email)}</a><br>
      <b>WhatsApp:</b> ${esc(p.whatsapp || '—')}<br><b>Tipo:</b> ${esc(p.tipo || '—')}<br>
      <b>Faixa:</b> ${esc(p.faixa || '—')} · <b>Prazo:</b> ${esc(p.prazo || '—')}</p>
      <p class="pre">${esc(p.descricao)}</p></div>
    <h2>Enviar orçamento</h2>
    <form class="card form" method="post" action="/admin/${p.id}">
      <label>Título<input name="titulo" value="${esc(p.titulo || '')}" placeholder="Ex.: Loja virtual completa" required></label>
      <label>Proposta (o que está incluso)<textarea name="proposta" rows="6" required>${esc(p.proposta || '')}</textarea></label>
      <label>Valor (R$)<input name="valor" type="number" step="0.01" min="1" value="${esc(p.valor || '')}" required></label>
      <button class="btn">${p.status === 'novo' ? 'Gerar link de pagamento' : 'Atualizar orçamento'}</button>
    </form>
    ${p.status !== 'novo' ? `<div class="card"><p><b>Link para o cliente:</b></p><input readonly value="${esc(link)}" onclick="this.select()">
      <p><a class="btn ghost" target="_blank" href="${esc(link)}">Abrir</a>
      ${p.whatsapp ? `<a class="btn ghost" target="_blank" href="https://wa.me/${esc(p.whatsapp.replace(/\D/g, ''))}?text=${encodeURIComponent(`Oi ${p.nome.split(' ')[0]}! Seu orçamento está pronto: ${link}`)}">Enviar no WhatsApp</a>` : ''}</p></div>` : ''}
    <form method="post" action="/admin/${p.id}/status" class="actions">
      ${p.status !== 'pago' ? '<button class="btn ghost" name="status" value="pago">Marcar como pago (Pix)</button>' : ''}
      ${p.status !== 'cancelado' ? '<button class="btn ghost danger" name="status" value="cancelado">Cancelar</button>' : ''}
    </form>`));
});

app.post('/admin/:id', auth, (req, res) => {
  const valor = Number(String(req.body.valor).replace(',', '.'));
  if (!(valor > 0)) return res.redirect(`/admin/${req.params.id}`);
  const p = db.findById(req.params.id);
  if (!p || p.status === 'pago') return res.redirect(`/admin/${req.params.id}`);
  db.update(req.params.id, { titulo: String(req.body.titulo).slice(0, 120), proposta: String(req.body.proposta).slice(0, 5000), valor, status: 'orcado' });
  res.redirect(`/admin/${req.params.id}`);
});

app.post('/admin/:id/status', auth, (req, res) => {
  const status = req.body.status;
  if (['pago', 'cancelado'].includes(status)) {
    db.update(req.params.id, { status, ...(status === 'pago' ? { pagoVia: 'pix', pagoEm: new Date().toISOString() } : {}) });
  }
  res.redirect(`/admin/${req.params.id}`);
});

const port = process.env.PORT || 3000;
if (require.main === module) app.listen(port, () => console.log(`${cfg.brand} rodando em http://localhost:${port}`));
module.exports = app;
