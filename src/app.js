// Ternura · Cloudflare Worker: orçamento, pagamento (Pix e cartão pela Stripe) e painel.
import * as precos from './precos.js';
import * as db from './db.js';
import { stripeAtivo, criarCheckout, lerCheckout, eventoStripe } from './stripe.js';
import { esc, brl, cut, iguais } from './util.js';

const STATUS = { novo: 'Novo', orcado: 'Aguardando pagamento', pago: 'Pago', cancelado: 'Cancelado' };
const primeiroNome = (n) => String(n || '').split(' ')[0];

function config(env, url) {
  return {
    brand: env.BRAND_NAME || 'Ternura',
    baseUrl: (env.BASE_URL || url.origin).replace(/\/$/, ''),
    stripeMetodos: String(env.STRIPE_METHODS || 'card,pix').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const html = (h, status = 200) => new Response(h, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
const ir = (para, status = 302) => new Response(null, { status, headers: { location: para } });

function pagina(cfg, titulo, corpo, { admin = false } = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${admin ? esc(titulo) + ' · ' : ''}${esc(cfg.brand)}</title>
<link rel="icon" href="/img/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/ternura.css">${admin ? '' : '<script type="module" src="/js/i18n.js"></script>'}</head>
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
  if (!c.nome || !c.email || !c.whatsapp) return 'Preencha nome, e-mail e WhatsApp.';
  if (String(c.whatsapp).replace(/\D/g, '').length < 10) return 'WhatsApp inválido. Coloque com DDD.';
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
  // Sem webhook? Consulta a sessão da Stripe de vez em quando (Pix confirma em segundos).
  if (p.status === 'orcado' && p.stripeSessao && stripeAtivo(env) && Date.now() - (p.checado || 0) > 8000) {
    p = await db.atualizar(env.DB, p.id, { checado: Date.now() });
    try {
      const s = await lerCheckout(env, p.stripeSessao);
      if (s.payment_status === 'paid') p = await marcarPago(env, p.id, { pagoVia: 'stripe', stripeSession: s.id });
    } catch (e) { console.error('Status Stripe:', e.message); }
  }
  return json({ status: p.status });
}

// ---------- pagamento ----------
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
      <p><span>Obrigada</span>, ${esc(primeiroNome(p.nome))}! <span>O pedido</span> <b>#${p.id}</b> <span>está pago. Em até 1 dia útil eu te chamo no WhatsApp ou e-mail que você deixou pra gente começar.</span></p>
      <a class="btn" href="/">Voltar ao site</a></div>`));
  }

  const metodos = cfg.stripeMetodos;
  const nomeMetodos = metodos.includes('pix') && metodos.includes('card') ? 'Pix ou cartão' : metodos.includes('pix') ? 'Pix' : 'Cartão';
  const blocoPag = stripeAtivo(env)
    ? `<div class="opcao-pag"><h3>${nomeMetodos}</h3>
      <p class="suave"><span>Pagamento seguro pela Stripe.</span>${metodos.includes('pix') ? ' <span>No Pix a aprovação é na hora.</span>' : ''}${env.STRIPE_PARCELAS === '1' ? ' <span>No cartão dá pra parcelar.</span>' : ''}</p>
      <form method="post" action="/pagar/${esc(p.token)}/stripe"><button class="btn largo"><span>Pagar</span> ${brl(p.valor)}</button></form></div>`
    : `<div class="opcao-pag"><h3>Pedido recebido</h3><p class="suave">Vou te chamar no WhatsApp ou e-mail que você informou pra combinar o pagamento.</p></div>`;
  const itens = (p.itens || []).map((i) => `<li><span data-item>${esc(i.nome)}</span><b>${brl(i.valor)}</b></li>`).join('');
  const resumo = p.itens
    ? `<ul class="itens">${itens}</ul>
       <div class="total"><span>${p.mensal ? 'Total do projeto (por mês)' : 'Total do projeto'}</span><strong>${brl(p.total)}</strong></div>
       ${p.valor !== p.total ? `<div class="total agora"><span>Entrada agora (50%)</span><strong>${brl(p.valor)}</strong></div>` : ''}
       ${p.prazo ? `<p class="suave peq" data-prazo="${esc(p.prazo)}">Prazo estimado: ${esc(p.prazo)}, contado depois do pagamento e do briefing.</p>` : ''}`
    : `<p class="pre">${esc(p.proposta || '')}</p><div class="total"><span>Total</span><strong>${brl(p.valor)}</strong></div>`;

  return html(pagina(cfg, `Pedido #${p.id}`, `
    <p class="sobretitulo"><span>Orçamento</span> #${p.id}</p>
    <h1 data-item>${esc(p.titulo || 'Seu projeto')}</h1>
    ${p.negocio ? `<p class="suave"><span>Para</span> <b>${esc(p.negocio)}</b></p>` : ''}
    <div class="cartao">${resumo}</div>
    <h2>Como você quer pagar?</h2>
    <div class="grade-pag">${blocoPag}</div>
    ${p.stripeSessao ? `<script>setInterval(async () => { try { const r = await fetch('/api/status/${p.token}'); const d = await r.json(); if (d.status === 'pago') location.reload(); } catch {} }, 5000);</script>` : ''}`));
}

async function pagarStripe(env, cfg, token) {
  const p = await db.porToken(env.DB, token);
  if (!p || p.status !== 'orcado' || !stripeAtivo(env)) return ir(`/pagar/${token}`, 303);
  const abrir = (metodos) => criarCheckout(env, {
      pedido: p.id, valor: p.valor, nome: `${p.titulo || 'Projeto'} (#${p.id})`, email: p.email,
      metodos, parcelas: env.STRIPE_PARCELAS === '1',
      sucesso: `${cfg.baseUrl}/pagar/${p.token}?session_id={CHECKOUT_SESSION_ID}`,
      cancelar: `${cfg.baseUrl}/pagar/${p.token}`,
    });
  try {
    let s;
    try { s = await abrir(cfg.stripeMetodos); } catch (e) {
      // Pix (ou parcelamento) ainda não ativado na Stripe: tenta só cartão.
      if (cfg.stripeMetodos.length === 1 && env.STRIPE_PARCELAS !== '1') throw e;
      console.error('Stripe, tentando só cartão:', e.message);
      s = await criarCheckout(env, { pedido: p.id, valor: p.valor, nome: `${p.titulo || 'Projeto'} (#${p.id})`, email: p.email, metodos: ['card'], parcelas: false,
        sucesso: `${cfg.baseUrl}/pagar/${p.token}?session_id={CHECKOUT_SESSION_ID}`, cancelar: `${cfg.baseUrl}/pagar/${p.token}` });
    }
    await db.atualizar(env.DB, p.id, { stripeSessao: s.id });
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
      if (caminho === '/config.json') return json({ brand: cfg.brand });
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
      if (caminho === '/admin' || caminho.startsWith('/admin/')) return admin(env, cfg, req, caminho.split('/').slice(2).filter(Boolean));
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return html(pagina(cfg, 'Erro', '<div class="cartao centro"><h1>Ops</h1><p>Algo deu errado. Tente de novo em instantes.</p></div>'), 500);
    }
  },
};
