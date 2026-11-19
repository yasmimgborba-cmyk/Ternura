// Simula o Cloudflare no Node: D1 (node:sqlite) e ASSETS (arquivos de public/).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

export function d1(arquivo = ':memory:') {
  const db = new DatabaseSync(arquivo);
  db.exec(readFileSync(join(RAIZ, 'schema.sql'), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
  });
  return { prepare: (sql) => stmt(sql) };
}

export const assets = {
  async fetch(req) {
    const p = decodeURIComponent(new URL(req.url).pathname);
    const pub = join(RAIZ, 'public');
    for (const c of [p, p + '.html', join(p, 'index.html')]) {
      const f = join(pub, c);
      if (f.startsWith(pub) && existsSync(f) && statSync(f).isFile()) {
        return new Response(readFileSync(f), { headers: { 'content-type': TIPOS[extname(f)] || 'application/octet-stream' } });
      }
    }
    return new Response('Não encontrado', { status: 404 });
  },
};
