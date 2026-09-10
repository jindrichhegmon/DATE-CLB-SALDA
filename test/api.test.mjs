// node --test test/  – API a datová vrstva s mockem databáze (bez SQL Serveru)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/api.mjs';
import { validateTp } from '../src/salda.mjs';

function mockDb() {
  let rows = [
    { id: 1, firma: 'CLB', popis: 'ALZA', frekvence: 'Měsíční', castka: 3575, datum: '2026-09-15', zmeneno: null },
    { id: 2, firma: 'DATEC', popis: 'Byt 104 prodej', frekvence: 'Jednorázově', castka: -5100000, datum: '2026-09-24', zmeneno: null },
  ];
  const calls = [];
  return {
    calls,
    async query(sqlText, params) {
      calls.push({ sql: sqlText.replace(/\s+/g, ' ').trim(), params });
      if (/SELECT DB_NAME\(\)/.test(sqlText)) return [{ db: 'CLB1', server: 'SRV', login: 'clb1_app', cas: '2026-09-10' }];
      if (/SELECT COUNT\(\*\)/.test(sqlText)) return [{ n: 3, nenulove: 2 }];
      if (/FROM dbo\.CLBSaldoDO/.test(sqlText)) return [{ nazev: 'Lékárna Baťov s.r.o.', saldo: -21703.52, splatnost: '2026-09-14', corg: 18 }];
      if (/FROM dbo\.DATECSaldoDO/.test(sqlText)) return [];
      if (/FROM dbo\.CLBSaldoOD/.test(sqlText)) return [{ nazev: 'Česká správa\nInstitut Zlín', saldo: 1114, splatnost: '2026-07-20', corg: 217 }];
      if (/FROM dbo\.DATECSaldoOD/.test(sqlText)) return [{ nazev: 'ViVi', saldo: -1158.84, splatnost: '2026-06-30', corg: 3 }];
      if (/^\s*INSERT INTO dbo\.Salda_TrvalePrikazy/.test(sqlText)) { rows.push({ id: 7, firma: params.firma, popis: params.popis, frekvence: params.frekvence, castka: params.castka, datum: params.datum, zmeneno: null }); return [{ id: 7 }]; }
      if (/WHERE Id = @id/.test(sqlText)) return rows.filter(r => r.id === params.id);
      if (/FROM dbo\.Salda_TrvalePrikazy/.test(sqlText)) return rows;
      throw new Error('neočekávaný dotaz: ' + sqlText);
    },
    async exec(sqlText, params) {
      calls.push({ sql: sqlText.replace(/\s+/g, ' ').trim(), params });
      if (/^\s*UPDATE/.test(sqlText)) { const r = rows.find(x => x.id === params.id && x.firma === params.firma); if (!r) return 0; Object.assign(r, { popis: params.popis, frekvence: params.frekvence, castka: params.castka, datum: params.datum }); return 1; }
      if (/^\s*DELETE/.test(sqlText)) { const n = rows.length; rows = rows.filter(x => !(x.id === params.id && x.firma === params.firma)); return n - rows.length; }
      throw new Error('neočekávaný exec: ' + sqlText);
    },
  };
}
const call = (h, method, path, body) => h(new Request('https://salda.test' + path, {
  method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }));

test('health', async () => {
  const h = createHandler({ db: mockDb() });
  const r = await call(h, 'GET', '/api/health');
  assert.equal(r.status, 200); assert.equal((await r.json()).ok, true);
});

test('prehled: faktury + tp + odběratelé, převod řádků', async () => {
  const db = mockDb();
  const h = createHandler({ db });
  const r = await call(h, 'GET', '/api/prehled');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.faktury.centrum[0].castka, -21703.52);
  assert.equal(j.faktury.centrum[0].corg, '18');
  assert.equal(j.odberatele.centrum[0].nazev, 'Česká správa — Institut Zlín');
  assert.equal(j.odberatele.datec[0].castka, -1158.84);
  assert.equal(j.tp.centrum.length, 1); assert.equal(j.tp.datec[0].firma, 'datec');
  assert.ok(!db.calls.some(c => /Saldo(DO|OD)/.test(c.sql) && /INSERT|UPDATE|DELETE/.test(c.sql)), 'saldokonto se nikdy nemění');
});

test('prehled?cast=odberatele nečte faktury ani TP', async () => {
  const db = mockDb();
  const h = createHandler({ db });
  const j = await (await call(h, 'GET', '/api/prehled?cast=odberatele')).json();
  assert.equal(j.faktury, undefined); assert.equal(j.tp, undefined); assert.ok(j.odberatele);
  assert.ok(!db.calls.some(c => /SaldoDO|Salda_TrvalePrikazy/.test(c.sql)));
});

test('trvalé příkazy: vytvořit, upravit, smazat (parametrizovaně, firma se kontroluje)', async () => {
  const db = mockDb();
  const h = createHandler({ db });
  let r = await call(h, 'POST', '/api/tp/centrum', { popis: 'Test', frekvence: 'Měsíční', castka: '1234.5', datum: '2026-10-01' });
  assert.equal(r.status, 201);
  let j = await r.json(); assert.equal(j.zaznam.id, 7); assert.equal(j.zaznam.castka, 1234.5); assert.equal(j.zaznam.firma, 'centrum');
  const ins = db.calls.find(c => /INSERT/.test(c.sql)); assert.ok(ins.sql.includes('@popis') && !ins.sql.includes('Test'));
  r = await call(h, 'PUT', '/api/tp/datec/7', { popis: 'X', frekvence: 'Roční', castka: 5, datum: '2026-10-02' });
  assert.equal(r.status, 404);
  r = await call(h, 'PUT', '/api/tp/centrum/7', { popis: 'X', frekvence: 'Roční', castka: -5, datum: '2026-10-02' });
  j = await r.json(); assert.equal(r.status, 200); assert.equal(j.zaznam.popis, 'X'); assert.equal(j.zaznam.castka, -5);
  r = await call(h, 'DELETE', '/api/tp/centrum/7'); assert.equal((await r.json()).smazano, true);
  r = await call(h, 'DELETE', '/api/tp/centrum/7'); assert.equal(r.status, 404);
  r = await call(h, 'POST', '/api/tp/centrum', { popis: '', frekvence: 'Měsíční', castka: 1, datum: '2026-10-01' });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /popis/);
  r = await call(h, 'POST', '/api/tp/centrum', 'neni json'); assert.equal(r.status, 400);
  r = await call(h, 'GET', '/api/neco'); assert.equal(r.status, 404);
});

test('diag', async () => {
  const h = createHandler({ db: mockDb() });
  const j = await (await call(h, 'GET', '/api/diag')).json();
  assert.equal(j.db, 'CLB1'); assert.equal(j.tabulky['centrum.faktury'].radku, 3); assert.equal(j.tabulky.trvalePrikazy.radku, 3);
});

test('validateTp', () => {
  assert.deepEqual(validateTp({ popis: ' A ', frekvence: 'Měsíční', castka: '10.005', datum: '2026-01-31' }), { popis: 'A', frekvence: 'Měsíční', castka: 10.01, datum: '2026-01-31' });
  assert.throws(() => validateTp({ popis: 'A', frekvence: 'Měsíční', castka: 0, datum: '2026-01-31' }), /částku/);
  assert.throws(() => validateTp({ popis: 'A', frekvence: 'Měsíční', castka: 1, datum: '31.1.2026' }), /RRRR/);
});
