// Roda o site no computador: node local/dev.mjs  (lê o .env se existir)
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import app from '../src/app.js';
import { d1, assets } from './ambiente.mjs';

const env = {};
if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
Object.assign(env, { DB: d1(process.env.DB_FILE || 'local/pedidos.sqlite'), ASSETS: assets }, Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(ADMIN_PASSWORD|PIX_|MP_|STRIPE_|BASE_URL)/.test(k))));
const porta = process.env.PORT || 3000;
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await app.fetch(new Request(`http://localhost:${porta}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(porta, () => console.log(`Ternura em http://localhost:${porta}`));
