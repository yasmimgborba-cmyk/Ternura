// Pix pelo Mercado Pago: cria a cobrança, consulta o status e valida o webhook.
// Usa só fetch e WebCrypto, então roda no Cloudflare Workers e no Node.
import { hmacHex, iguais } from './util.js';

const API = (env) => (env.MP_API_BASE || 'https://api.mercadopago.com').replace(/\/$/, '');

export const mpAtivo = (env) => !!env.MP_ACCESS_TOKEN;

async function chamar(env, path, opts = {}) {
  const r = await fetch(API(env) + path, {
    ...opts,
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${data.message || JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// Cria uma cobrança Pix válida por 24h.
export async function criarPix(env, { pedido, valor, descricao, email, nome, notificationUrl }) {
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
  const p = await chamar(env, '/v1/payments', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': `${pedido}-${Number(valor).toFixed(2)}-${Date.now()}` },
    body: JSON.stringify(body),
  });
  const t = p.point_of_interaction?.transaction_data || {};
  return { id: String(p.id), status: p.status, copiaECola: t.qr_code, qrBase64: t.qr_code_base64, link: t.ticket_url, expira };
}

export const consultarPix = (env, id) => chamar(env, `/v1/payments/${encodeURIComponent(id)}`);

// Valida a assinatura x-signature (só se MP_WEBHOOK_SECRET estiver definido).
export async function assinaturaMpValida(env, headers, dataId) {
  if (!env.MP_WEBHOOK_SECRET) return true;
  const sig = String(headers.get('x-signature') || '');
  const parts = Object.fromEntries(sig.split(',').map((kv) => kv.trim().split('=')));
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${headers.get('x-request-id') || ''};ts:${parts.ts};`;
  return iguais(await hmacHex(env.MP_WEBHOOK_SECRET, manifest), parts.v1);
}
