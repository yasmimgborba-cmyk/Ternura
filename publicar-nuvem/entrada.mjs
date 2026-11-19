// Usado só ao publicar da nuvem do Claude: serve public/ de dentro do Worker (o upload de assets dá 401 por lá).
import app from '../src/app.js';
import A from './assets.mjs';
const TIPO = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml' };
const cache = {};
function corpo(p) {
  const [tipo, dados] = A[p];
  if (tipo === 't') return dados;
  return (cache[p] ||= Uint8Array.from(atob(dados), (c) => c.charCodeAt(0)));
}
function achar(p) {
  for (const c of [p, p + '.html', p.replace(/\/?$/, '/') + 'index.html']) if (A[c]) return c;
  return null;
}
const ASSETS = { async fetch(req) {
  const u = new URL(req.url);
  const p = achar(decodeURIComponent(u.pathname));
  if (!p) return new Response('Página não encontrada', { status: 404, headers: { 'content-type': TIPO.html } });
  if (p.endsWith('/index.html') && !u.pathname.endsWith('/')) return Response.redirect(u.origin + u.pathname + '/', 301);
  return new Response(corpo(p), { headers: { 'content-type': TIPO[p.split('.').pop()] || 'application/octet-stream', 'cache-control': 'public, max-age=600' } });
} };
export default { fetch: (req, env, ctx) => app.fetch(req, { ...env, ASSETS }, ctx) };
