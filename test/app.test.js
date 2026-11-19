const test = require('node:test');
const assert = require('node:assert');
const os = require('os'); const path = require('path');
process.env.DB_FILE = path.join(os.tmpdir(), `ternura-test-${process.pid}.json`);
process.env.ADMIN_PASSWORD = 'segredo';
process.env.PIX_KEY = 'teste@exemplo.com'; process.env.PIX_NAME = 'Fulana'; process.env.PIX_CITY = 'São Paulo';
const { buildPixPayload, crc16 } = require('../src/pix');
const app = require('../server');

test('CRC16 do Pix bate com o valor de referência', () => {
  assert.strictEqual(crc16('123456789'), '29B1');
});

test('payload Pix tem os campos certos', () => {
  const p = buildPixPayload({ key: 'a@b.com', name: 'José', city: 'São Paulo', amount: 150, txid: 'PED1' });
  assert.match(p, /^000201/); assert.match(p, /5406150\.00/); assert.match(p, /5303986/);
  assert.strictEqual(p.slice(-4), crc16(p.slice(0, -4)));
});

test('fluxo: pedido -> orçamento -> página de pagamento -> pago', async () => {
  const srv = app.listen(0); const base = `http://localhost:${srv.address().port}`;
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:segredo').toString('base64') };
  try {
    let r = await fetch(base + '/api/orcamento', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: 'Ana Teste', email: 'ana@x.com', descricao: 'Quero uma loja' }) });
    const { ok, id } = await r.json(); assert.ok(ok);
    assert.strictEqual((await fetch(base + '/admin')).status, 401);
    r = await fetch(`${base}/admin/${id}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'titulo=Loja&proposta=Tudo&valor=1500', redirect: 'manual' });
    assert.strictEqual(r.status, 302);
    const token = require('../src/db').findById(id).token;
    const html = await (await fetch(`${base}/pagar/${token}`)).text();
    assert.match(html, /R\$\s?1\.500,00/); assert.match(html, /QR Code Pix/);
    await fetch(`${base}/admin/${id}/status`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'status=pago', redirect: 'manual' });
    assert.match(await (await fetch(`${base}/pagar/${token}`)).text(), /Pagamento confirmado/);
  } finally { srv.close(); require('fs').rmSync(process.env.DB_FILE, { force: true }); }
});
