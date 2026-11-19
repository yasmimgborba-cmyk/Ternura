// Stripe sem SDK (fetch + WebCrypto): cria o checkout e valida o webhook.
import { hmacHex, iguais } from './util.js';

const API = (env) => (env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '');
export const stripeAtivo = (env) => !!env.STRIPE_SECRET_KEY;

function form(obj, prefixo = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const chave = prefixo ? `${prefixo}[${k}]` : k;
    if (typeof v === 'object') form(v, chave, out); else out.append(chave, String(v));
  }
  return out;
}

async function chamar(env, path, metodo = 'GET', corpo) {
  const r = await fetch(API(env) + path, {
    method: metodo,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo ? form(corpo) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${d.error?.message || ''}`);
  return d;
}

export function criarCheckout(env, { pedido, valor, nome, email, metodos, parcelas, sucesso, cancelar }) {
  const corpo = {
    mode: 'payment',
    customer_email: email,
    payment_method_types: Object.fromEntries(metodos.map((m, i) => [i, m])),
    line_items: { 0: { quantity: 1, price_data: { currency: 'brl', unit_amount: Math.round(valor * 100), product_data: { name: nome } } } },
    metadata: { pedido, site: 'ternura' },
    payment_intent_data: { metadata: { pedido, site: 'ternura' } },
    success_url: sucesso,
    cancel_url: cancelar,
  };
  if (parcelas && metodos.includes('card')) corpo.payment_method_options = { card: { installments: { enabled: true } } };
  return chamar(env, '/v1/checkout/sessions', 'POST', corpo);
}

export const lerCheckout = (env, id) => chamar(env, `/v1/checkout/sessions/${encodeURIComponent(id)}`);

// Confere o cabeçalho Stripe-Signature (t=...,v1=...) com tolerância de 5 min.
export async function eventoStripe(env, corpoBruto, cabecalho) {
  const partes = String(cabecalho || '').split(',').map((p) => p.split('='));
  const t = partes.find(([k]) => k === 't')?.[1];
  const v1s = partes.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !v1s.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return null;
  const esperado = await hmacHex(env.STRIPE_WEBHOOK_SECRET || '', `${t}.${corpoBruto}`);
  if (!v1s.some((v) => iguais(v, esperado))) return null;
  return JSON.parse(corpoBruto);
}
