// Pix pelo Mercado Pago: cria a cobrança, consulta o status e valida o webhook.
const crypto = require('crypto');

const API = () => (process.env.MP_API_BASE || 'https://api.mercadopago.com').replace(/\/$/, '');
const token = () => process.env.MP_ACCESS_TOKEN || '';
const ativo = () => !!token();

async function chamar(path, opts = {}) {
  const r = await fetch(API() + path, {
    ...opts,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${data.message || JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// Cria uma cobrança Pix. Vale por 24h.
async function criarPix({ pedido, valor, descricao, email, nome, notificationUrl }) {
  const expira = new Date(Date.now() + 24 * 3600 * 1000).toISOString().replace('Z', '-00:00');
  const body = {
    transaction_amount: Number(valor),
    description: String(descricao).slice(0, 200),
    payment_method_id: 'pix',
    external_reference: pedido,
    date_of_expiration: expira,
    payer: { email, first_name: String(nome || '').split(' ')[0] || undefined },
  };
  if (notificationUrl && /^https:\/\//.test(notificationUrl)) body.notification_url = notificationUrl;
  const p = await chamar('/v1/payments', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': `${pedido}-${Number(valor).toFixed(2)}-${Date.now()}` },
    body: JSON.stringify(body),
  });
  const t = p.point_of_interaction?.transaction_data || {};
  return { id: String(p.id), status: p.status, copiaECola: t.qr_code, qrBase64: t.qr_code_base64, link: t.ticket_url, expira };
}

const consultar = (id) => chamar(`/v1/payments/${encodeURIComponent(id)}`);

// Valida a assinatura x-signature (opcional: só se MP_WEBHOOK_SECRET estiver definido).
function assinaturaValida(headers, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true;
  const sig = String(headers['x-signature'] || '');
  const parts = Object.fromEntries(sig.split(',').map((kv) => kv.trim().split('=')));
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${headers['x-request-id'] || ''};ts:${parts.ts};`;
  const hash = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return hash.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(parts.v1));
}

module.exports = { ativo, criarPix, consultar, assinaturaValida };
