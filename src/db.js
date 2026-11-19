// Pedidos no Cloudflare D1. Cada pedido é uma linha com os dados em JSON.
import { aleatorioHex } from './util.js';

const linha = (r) => (r ? { ...JSON.parse(r.dados), id: r.id, token: r.token, status: r.status, criadoEm: r.criado_em } : null);

export async function listar(DB) {
  const { results } = await DB.prepare('SELECT * FROM pedidos ORDER BY criado_em DESC LIMIT 500').all();
  return results.map(linha);
}

export async function criar(DB, dados) {
  const p = { id: aleatorioHex(4).toUpperCase(), token: aleatorioHex(16), status: dados.status || 'novo', criadoEm: new Date().toISOString() };
  const { status, ...resto } = dados;
  await DB.prepare('INSERT INTO pedidos (id, token, status, criado_em, dados) VALUES (?, ?, ?, ?, ?)')
    .bind(p.id, p.token, p.status, p.criadoEm, JSON.stringify(resto)).run();
  return { ...resto, ...p };
}

export async function atualizar(DB, id, mudancas) {
  const atual = await porId(DB, id);
  if (!atual) return null;
  const novo = { ...atual, ...mudancas, atualizadoEm: new Date().toISOString() };
  const { id: _i, token: _t, status, criadoEm: _c, ...dados } = novo;
  await DB.prepare('UPDATE pedidos SET status = ?, dados = ? WHERE id = ?').bind(status, JSON.stringify(dados), id).run();
  return novo;
}

export const porId = async (DB, id) => linha(await DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first());
export const porToken = async (DB, t) => linha(await DB.prepare('SELECT * FROM pedidos WHERE token = ?').bind(t).first());
