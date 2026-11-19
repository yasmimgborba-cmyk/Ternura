// Ternura · Cloudflare Worker: orçamento, pagamentos (Pix Mercado Pago + Stripe) e painel.
import * as precos from './precos.js';
import * as db from './db.js';
import { buildPixPayload } from './pix.js';
import { mpAtivo, criarPix, consultarPix, assinaturaMpValida } from './mercadopago.js';
import { stripeAtivo, criarCheckout, lerCheckout, eventoStripe } from './stripe.js';
import { esc, brl, cut, iguais } from './util.js';

const STATUS = { novo: 'Novo', orcado: 'Aguardando pagamento', pago: 'Pago', cancelado: 'Cancelado' };
const primeiroNome = (n) => String(n || '').split(' ')[0];

function config(env, url) {
  return {
    brand: env.BRAND_NAME || 'Ternura',
    email: env.CONTACT_EMAIL ?? 'yasmimgborba@gmail.com',
    whatsapp: String(env.WHATSAPP ?? '5562998778446').replace(/\D/g, ''),
    instagram: String(env.INSTAGRAM ?? 'ywwsmim').replace(/^@/, ''),
    baseUrl: (env.BASE_URL || url.origin).replace(/\/$/, ''),
    stripeMetodos: String(env.STRIPE_METHODS || 'card').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const html = (h, status = 200) => new Response(h, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
const ir = (para, status = 302) => new Response(null, { status, headers: { location: para } });

function pagina(cfg, titulo, corpo, { admin = false } = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(titulo)} · ${esc(cfg.brand)}</title>
<link rel="icon" href="/img/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/ternura.css"></head>
<body class="inner"><header class="topo"><div class="topo-in"><a class="marca" href="/"><img src="/img/logo.png" alt="${esc(cfg.brand)}"></a>
${admin ? '<nav class="menu"><a href="/admin">Pedidos</a></nav>' : '<nav class="menu"><a href="/#portfolio">Portfólio</a><a class="btn sm" href="/orcamento">Fazer orçamento</a></nav>'}</div></header>
<main class="wrap estreito">${corpo}</main></body></html>`;
}

async function corpoDe(req) {
  const tipo = req.headers.get('content-type') || '';
  if (tipo.includes('application/json')) return req.json().catch(() => ({}));
  if (tipo.includes('form')) return Object.fromEntries(await req.formData());
  return {};
}

async function marcarPago(env, id, extra) {
  const p = await db.porId(env.DB, id);
  if (!p || p.status === 'pago') return p;
  return db.atualizar(env.DB, id, { status: 'pago', pagoEm: new Date().toISOString(), ...extra });
}

function validarCliente(c = {}) {
  if (!c.nome || !c.email) return 'Preencha nome e e-mail.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return 'E-mail inválido.';
  return null;
}

// ---------- API pública ----------
async function apiOrcamento(env, req) {
  const b = await corpoDe(req);
  if (b.site) return json({ ok: true });
  const erro = validarCliente(b) || (!b.descricao && 'Conte um pouco da sua ideia.');
  if (erro) return json({ ok: false, erro }, 400);
  const p = await db.criar(env.DB, {
    origem: 'contato', nome: cut(b.nome, 120), email: cut(b.email, 160), whatsapp: cut(b.whatsapp, 40),
    tipo: cut(b.tipo, 60), faixa: cut(b.orcamento, 60), prazo: cut(b.prazo, 60), descricao: cut(b.descricao, 4000),
  });
  return json({ ok: true, id: p.id });
}

async function apiPedido(env, req) {
  const { config: c = {}, cliente = {}, site } = await corpoDe(req);
  if (site) return json({ ok: true });
  const erro = validarCliente(cliente);
  if (erro) return json({ ok: false, erro }, 400);
  let calc;
  try { calc = precos.calcular(c); } catch (e) { return json({ ok: false, erro: e.message }, 400); }
  const paleta = precos.paletas[c.paleta] ? c.paleta : 'personalizada';
  const cores = (Array.isArray(c.cores) ? c.cores : []).filter((x) => /^#[0-9a-f]{6}$/i.test(x)).slice(0, 4);
  const p = await db.criar(env.DB, {
    origem: 'configurador', status: 'orcado',
    nome: cut(cliente.nome, 120), email: cut(cliente.email, 160), whatsapp: cut(cliente.whatsapp, 40),
    negocio: cut(cliente.negocio, 80), descricao: cut(cliente.obs, 3000),
    tipo: precos.servicos[calc.servico].nome, titulo: calc.titulo, itens: calc.itens, total: calc.total,
    valor: calc.agora, pagamento: calc.pagamento, mensal: calc.mensal, prazo: calc.prazo,
    escolhas: { servico: calc.servico, modelo: calc.modelo, estilo: calc.estilo, urgencia: calc.urgencia, paleta, cores },
  });
  return json({ ok: true, id: p.id, url: `/pagar/${p.token}` });
}

async function apiStatus(env, token) {
  let p = await db.porToken(env.DB, token);
  if (!p) return json({ status: 'inexistente' }, 404);
  // Sem webhook? Consulta o Mercado Pago de vez em quando.
  if (p.status === 'orcado' && p.mp?.id && mpAtivo(env) && Date.now() - (p.mp.checado || 0) > 8000) {
    p = await db.atualizar(env.DB, p.id, { mp: { ...p.mp, checado: Date.now() } });
    try {
      const pay = await consultarPix(env, p.mp.id);
      if (pay.status === 'approved') p = await marcarPago(env, p.id, { pagoVia: 'pix-mercadopago', mpPagamento: String(pay.id) });
    } catch (e) { console.error('Status MP:', e.message); }
  }
  return json({ status: p.status });
}

// ---------- pagamento ----------
async function pixDoPedido(env, cfg, p) {
  if (mpAtivo(env)) {
    const ok = p.mp && p.mp.valor === p.valor && new Date(p.mp.expira) - Date.now() > 30 * 60 * 1000;
    if (ok) return p.mp;
    const pix = await criarPix(env, {
      pedido: p.id, valor: p.valor, descricao: `${cfg.brand} · pedido #${p.id}`, email: p.email, nome: p.nome,
      notificationUrl: `${cfg.baseUrl}/webhook/mercadopago`,
    });
    const salvo = { ...pix, valor: p.valor };
    await db.atualizar(env.DB, p.id, { mp: salvo });
    return salvo;
  }
  if (env.PIX_KEY) {
    return { copiaECola: buildPixPayload({ key: env.PIX_KEY, name: env.PIX_NAME, city: env.PIX_CITY, amount: p.valor, txid: 'PED' + p.id }), estatico: true };
  }
  return null;
}

async function paginaPagar(env, cfg, token, url) {
  let p = await db.porToken(env.DB, token);
  if (!p || p.status === 'novo' || p.status === 'cancelado') {
    return html(pagina(cfg, 'Não encontrado', '<div class="cartao centro"><h1>Link inválido</h1><p>Esse orçamento não existe ou ainda não foi liberado.</p></div>'), 404);
  }
  // Voltou do Stripe: confere direto na API.
  const sessao = url.searchParams.get('session_id');
  if (sessao && p.status === 'orcado' && stripeAtivo(env)) {
    try {
      const s = await lerCheckout(env, sessao);
      if (s.payment_status === 'paid' && s.metadata?.pedido === p.id) p = await marcarPago(env, p.id, { pagoVia: 'stripe', stripeSession: s.id });
    } catch (e) { console.error('Stripe retorno:', e.message); }
  }
  if (p.status === 'pago') {
    return html(pagina(cfg, 'Pago', `<div class="cartao centro"><div class="icone-ok">✓</div><h1>Pagamento confirmado!</h1>
      <p>Obrigada, ${esc(primeiroNome(p.nome))}! O pedido <b>#${p.id}</b> está pago. Em até 1 dia útil você recebe uma mensagem pra gente começar.</p>
      <a class="btn" href="/">Voltar ao site</a></div>`));
  }

  let pix = null, pixErro = false;
  try { pix = await pixDoPedido(env, cfg, p); } catch (e) { console.error('Pix:', e.message); pixErro = true; }

  let blocoPix = '';
  if (pix) {
    const qr = pix.qrBase64 ? `<img class="qr" src="data:image/png;base64,${esc(pix.qrBase64)}" alt="QR Code Pix">` : '<div class="qr" id="qr"></div>';
    blocoPix = `<div class="opcao-pag"><h3>Pix</h3><p class="suave">${pix.estatico ? 'Escaneie ou copie o código.' : 'Aprovação na hora, confirmado automaticamente.'}</p>
      ${qr}
      <textarea id="pix" readonly>${esc(pix.copiaECola)}</textarea>
      <button class="btn contorno" type="button" onclick="navigator.clipboard.writeText(document.getElementById('pix').value);this.textContent='Copiado'">Copiar Pix copia e cola</button>
      ${pix.estatico
        ? `<p class="suave peq">Depois de pagar, mande o comprovante${cfg.whatsapp ? ` no <a href="https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent('Comprovante do pedido #' + p.id)}">WhatsApp</a>` : ''}.</p>
           <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
           <script>new QRCode(document.getElementById('qr'), { text: document.getElementById('pix').value, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });</script>`
        : '<p class="suave peq">Esperando o pagamento… esta página atualiza sozinha.</p>'}</div>`;
  } else if (pixErro) {
    blocoPix = '<div class="opcao-pag"><h3>Pix</h3><p class="suave">O Pix está instável agora. Tente de novo em alguns minutos ou pague no cartão.</p></div>';
  }
  const blocoCartao = stripeAtivo(env)
    ? `<div class="opcao-pag"><h3>Cartão de crédito</h3><p class="suave">Pagamento seguro pela Stripe.</p>
      <form method="post" action="/pagar/${esc(p.token)}/stripe"><button class="btn">Pagar ${brl(p.valor)} no cartão</button></form></div>`
    : '';

  const itens = (p.itens || []).map((i) => `<li><span>${esc(i.nome)}</span><b>${brl(i.valor)}</b></li>`).join('');
  const resumo = p.itens
    ? `<ul class="itens">${itens}</ul>
       <div class="total"><span>Total do projeto${p.mensal ? ' (por mês)' : ''}</span><strong>${brl(p.total)}</strong></div>
       ${p.valor !== p.total ? `<div class="total agora"><span>Entrada agora (50%)</span><strong>${brl(p.valor)}</strong></div>` : ''}
       ${p.prazo ? `<p class="suave peq">Prazo estimado: ${esc(p.prazo)}, contado depois do pagamento e do briefing.</p>` : ''}`
    : `<p class="pre">${esc(p.proposta || '')}</p><div class="total"><span>Total</span><strong>${brl(p.valor)}</strong></div>`;
  const contato = cfg.whatsapp
    ? `<p class="suave peq centro">Dúvidas? <a href="https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent('Oi! Tenho uma dúvida sobre o pedido #' + p.id)}">Fale comigo no WhatsApp</a></p>`
    : cfg.email ? `<p class="suave peq centro">Dúvidas? <a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a></p>` : '';

  return html(pagina(cfg, `Pedido #${p.id}`, `
    <p class="sobretitulo">Orçamento #${p.id}</p>
    <h1>${esc(p.titulo || 'Seu projeto')}</h1>
    ${p.negocio ? `<p class="suave">Para <b>${esc(p.negocio)}</b></p>` : ''}
    <div class="cartao">${resumo}</div>
    <h2>Como você quer pagar?</h2>
    <div class="grade-pag">${blocoPix}${blocoCartao}</div>
    ${!blocoPix && !blocoCartao ? '<p>Formas de pagamento ainda não configuradas. Fale comigo pelo WhatsApp.</p>' : ''}
    ${contato}
    ${pix && !pix.estatico ? `<script>setInterval(async () => { try { const r = await fetch('/api/status/${p.token}'); const d = await r.json(); if (d.status === 'pago') location.reload(); } catch {} }, 5000);</script>` : ''}`));
}

async function pagarStripe(env, cfg, token) {
  const p = await db.porToken(env.DB, token);
  if (!p || p.status !== 'orcado' || !stripeAtivo(env)) return ir(`/pagar/${token}`, 303);
  try {
    const s = await criarCheckout(env, {
      pedido: p.id, valor: p.valor, nome: `${p.titulo || 'Projeto'} (#${p.id})`, email: p.email,
      metodos: cfg.stripeMetodos, parcelas: env.STRIPE_PARCELAS === '1',
      sucesso: `${cfg.baseUrl}/pagar/${p.token}?session_id={CHECKOUT_SESSION_ID}`,
      cancelar: `${cfg.baseUrl}/pagar/${p.token}`,
    });
    return ir(s.url, 303);
  } catch (e) {
    console.error('Stripe:', e.message);
    return html(pagina(cfg, 'Erro', '<div class="cartao centro"><h1>Ops</h1><p>Não deu pra abrir o pagamento no cartão agora. Tente o Pix ou fale comigo.</p></div>'), 500);
  }
}

// ---------- webhooks ----------
async function webhookStripe(env, req) {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('sem segredo', { status: 400 });
  const ev = await eventoStripe(env, await req.text(), req.headers.get('stripe-signature'));
  if (!ev) return new Response('assinatura inválida', { status: 400 });
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(ev.type)) {
    const s = ev.data.object;
    if (s.payment_status === 'paid' && s.metadata?.site === 'ternura' && s.metadata?.pedido) {
      await marcarPago(env, s.metadata.pedido, { pagoVia: 'stripe', stripeSession: s.id });
    }
  }
  return json({ received: true });
}

async function webhookMp(env, req, url) {
  const b = await req.json().catch(() => ({}));
  const id = b?.data?.id || url.searchParams.get('data.id') || url.searchParams.get('id');
  const tipo = b?.type || url.searchParams.get('type') || url.searchParams.get('topic');
  if (!id || (tipo && tipo !== 'payment') || !mpAtivo(env)) return new Response('ok');
  if (!(await assinaturaMpValida(env, req.headers, id))) return new Response('assinatura inválida', { status: 401 });
  try {
    const pay = await consultarPix(env, id); // nunca confia no corpo: consulta direto no Mercado Pago
    if (pay.status === 'approved' && pay.external_reference) {
      const p = await db.porId(env.DB, pay.external_reference);
      if (p && Math.abs(Number(pay.transaction_amount) - Number(p.valor)) < 0.01) {
        await marcarPago(env, p.id, { pagoVia: 'pix-mercadopago', mpPagamento: String(pay.id) });
      }
    }
  } catch (e) {
    console.error('Webhook MP:', e.message);
    return new Response('erro', { status: 500 });
  }
  return new Response('ok');
}

// ---------- painel ----------
function autorizado(env, req) {
  if (!env.ADMIN_PASSWORD) return false;
  const [tipo, cred] = (req.headers.get('authorization') || '').split(' ');
  if (tipo !== 'Basic' || !cred) return false;
  let txt = '';
  try { txt = atob(cred); } catch { return false; }
  const i = txt.indexOf(':');
  return txt.slice(0, i) === 'admin' && iguais(txt.slice(i + 1), env.ADMIN_PASSWORD);
}

async function admin(env, cfg, req, partes) {
  if (!env.ADMIN_PASSWORD) return new Response('Defina o segredo ADMIN_PASSWORD', { status: 503 });
  if (!autorizado(env, req)) return new Response('Acesso restrito', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="admin"' } });
  const [id, acao] = partes;

  if (!id) {
    const pedidos = await db.listar(env.DB);
    const rows = pedidos.map((p) => `<a class="linha" href="/admin/${p.id}">
      <span><b>#${p.id}</b> ${esc(p.nome)}${p.negocio ? ` · ${esc(p.negocio)}` : ''}<br><span class="suave peq">${esc(p.tipo || '')} · ${p.origem === 'configurador' ? 'orçamento automático' : 'sob consulta'} · ${new Date(p.criadoEm).toLocaleDateString('pt-BR')}</span></span>
      <span>${p.valor ? brl(p.valor) : ''} <span class="etiqueta ${p.status}">${STATUS[p.status]}</span></span></a>`).join('');
    const recebido = pedidos.filter((p) => p.status === 'pago').reduce((s, p) => s + Number(p.valor || 0), 0);
    return html(pagina(cfg, 'Painel', `<h1>Pedidos</h1><p class="suave">${pedidos.length} pedidos · ${brl(recebido)} recebidos</p>
      <div class="lista">${rows || '<p class="suave">Nenhum pedido ainda.</p>'}</div>`, { admin: true }));
  }

  const p = await db.porId(env.DB, id);
  if (!p) return ir('/admin');

  if (req.method === 'POST') {
    const b = await corpoDe(req);
    if (acao === 'status') {
      if (b.status === 'pago') await marcarPago(env, p.id, { pagoVia: 'manual' });
      if (b.status === 'cancelado') await db.atualizar(env.DB, p.id, { status: 'cancelado' });
    } else {
      const valor = Number(String(b.valor).replace(',', '.'));
      if (p.status !== 'pago' && valor > 0) {
        await db.atualizar(env.DB, p.id, { titulo: cut(b.titulo, 120), proposta: cut(b.proposta, 5000), valor, total: valor, status: 'orcado' });
      }
    }
    return ir(`/admin/${p.id}`);
  }

  const link = `${cfg.baseUrl}/pagar/${p.token}`;
  const e = p.escolhas;
  const escolhas = e ? `<p><b>Serviço:</b> ${esc(p.tipo)} · <b>Modelo:</b> ${esc(precos.modelos[e.modelo]?.nome)} · <b>Estilo:</b> ${esc(precos.estilos[e.estilo]?.nome)}<br>
      <b>Cores:</b> ${(e.cores || []).map((c) => `<span class="amostra" style="background:${esc(c)}"></span>${esc(c)}`).join(' ')}<br>
      <b>Itens:</b> ${(p.itens || []).map((i) => esc(i.nome)).join(', ')}<br>
      <b>Pagamento:</b> ${esc(precos.pagamentos[p.pagamento]?.nome || '')} · <b>Total:</b> ${brl(p.total)} · <b>Prazo:</b> ${esc(p.prazo)}</p>` : '';
  return html(pagina(cfg, `#${p.id}`, `<p><a href="/admin">← Pedidos</a></p>
    <h1>#${p.id} · ${esc(p.nome)} <span class="etiqueta ${p.status}">${STATUS[p.status]}</span></h1>
    <div class="cartao"><p><b>E-mail:</b> <a href="mailto:${esc(p.email)}">${esc(p.email)}</a><br>
      <b>WhatsApp:</b> ${esc(p.whatsapp || '—')}${p.negocio ? `<br><b>Negócio:</b> ${esc(p.negocio)}` : ''}
      ${p.faixa ? `<br><b>Faixa:</b> ${esc(p.faixa)} · <b>Prazo:</b> ${esc(p.prazo || '—')}` : ''}</p>
      ${escolhas}
      ${p.descricao ? `<p class="pre">${esc(p.descricao)}</p>` : ''}
      ${p.pagoVia ? `<p><b>Pago via:</b> ${esc(p.pagoVia)} em ${new Date(p.pagoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>` : ''}</div>
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
}

// ---------- roteador ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cfg = config(env, url);
    const caminho = url.pathname;
    const m = req.method;
    try {
      if (caminho === '/config.json') return json({ brand: cfg.brand, email: cfg.email, whatsapp: cfg.whatsapp, instagram: cfg.instagram });
      if (caminho === '/api/catalogo') {
        const { servicos, modelos, estilos, paletas, extras, urgencias, pagamentos } = precos;
        return json({ servicos, modelos, estilos, paletas, extras, urgencias, pagamentos });
      }
      if (caminho === '/api/calcular' && m === 'POST') {
        try { return json({ ok: true, ...precos.calcular(await corpoDe(req)) }); } catch (e) { return json({ ok: false, erro: e.message }, 400); }
      }
      if (caminho === '/api/orcamento' && m === 'POST') return apiOrcamento(env, req);
      if (caminho === '/api/pedido' && m === 'POST') return apiPedido(env, req);
      let r = caminho.match(/^\/api\/status\/([0-9a-f]{32})$/);
      if (r) return apiStatus(env, r[1]);
      r = caminho.match(/^\/pagar\/([0-9a-f]{32})(\/stripe)?$/);
      if (r) return r[2] ? (m === 'POST' ? pagarStripe(env, cfg, r[1]) : ir(`/pagar/${r[1]}`)) : paginaPagar(env, cfg, r[1], url);
      if (caminho === '/webhook/stripe' && m === 'POST') return webhookStripe(env, req);
      if (caminho === '/webhook/mercadopago' && m === 'POST') return webhookMp(env, req, url);
      if (caminho === '/admin' || caminho.startsWith('/admin/')) return admin(env, cfg, req, caminho.split('/').slice(2).filter(Boolean));
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return html(pagina(cfg, 'Erro', '<div class="cartao centro"><h1>Ops</h1><p>Algo deu errado. Tente de novo em instantes.</p></div>'), 500);
    }
  },
};
