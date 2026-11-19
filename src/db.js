// Armazenamento simples em arquivo JSON (bom para começar; troque por um banco depois).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'db.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { pedidos: [] };
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

function list() {
  return load().pedidos.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

function create(data) {
  const db = load();
  const pedido = {
    id: crypto.randomBytes(4).toString('hex').toUpperCase(),
    token: crypto.randomBytes(16).toString('hex'),
    status: 'novo', // novo -> orcado -> pago
    criadoEm: new Date().toISOString(),
    ...data,
  };
  db.pedidos.push(pedido);
  save(db);
  return pedido;
}

function update(id, changes) {
  const db = load();
  const p = db.pedidos.find((x) => x.id === id);
  if (!p) return null;
  Object.assign(p, changes, { atualizadoEm: new Date().toISOString() });
  save(db);
  return p;
}

const findById = (id) => load().pedidos.find((x) => x.id === id);
const findByToken = (t) => load().pedidos.find((x) => x.token === t);

module.exports = { list, create, update, findById, findByToken };
