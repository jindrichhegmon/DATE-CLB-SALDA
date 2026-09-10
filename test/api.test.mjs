// node --test test/  – API a datová vrstva s mockem databází (bez SQL Serveru)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/api.mjs';
import { validateTp } from '../src/salda.mjs';

function mockDbs() {
  let tp = [
    { id: 1, firma: 'CLB', popis: 'ALZA', frekvence: 'Měsíční', castka: 3575, datum: '2026-09-15', zmeneno: null },
    { id: 2, firma: 'DATEC', popis: 'Byt 104 prodej', frekvence: 'Jednorázově', castka: -5100000, datum: '2026-09-24', zmeneno: null },
  ];
  const calls = [];
  const helios = (name, data) => ({
    name,
    async query(sqlText, params) {
      calls.push({ name, sql: sqlText.replace(/\s+/g, ' ').trim(), params });
      if (/SELECT DB_NAME\(\)/.test(sqlText)) return [{ db: name, server: 'SRV', login: 'ro' }];
      if (/SELECT COUNT\(\*\)/.test(sqlText)) return [{ n: 10, otevrenych: data[params.skupina].length }];
      if (/FROM dbo\.TabSaldo/.test(sqlText)) { assert.ok(params && params.skupina, 'skupina jako parametr'); return data[params.skupina] || []; }
      throw new Error('mock ' + name + ': neočekávaný dotaz ' + sqlText);
    },
    async exec() { throw new Error('do Heliosu se nezapisuje'); },
  });
  const clb1 = {
    name: 'clb1',
    async query(sqlText, params) {
      calls.push({ name: 'clb1', sql: sqlText.replace(/\s+/g, ' ').trim(), params });
      if (/SELECT DB_NAME\(\)/.test(sqlText)) return [{ db: 'CLB1', server: 'SRV', login: 'clb1_app' }];
      if (/SELECT COUNT\(\*\)/.test(sqlText)) return [{ n: tp.length }];
      if (/^\s*INSERT INTO dbo\.Salda_TrvalePrikazy/.test(sqlText)) { tp.push({ id: 7, firma: params.firma, popis: params.popis, frekvence: params.frekvence, castka: params.castka, datum: params.datum, zmeneno: null }); return [{ id: 7 }]; }
      if (/WHERE Id = @id/.test(sqlText)) return tp.filter(r => r.id === params.id);
      if (/FROM dbo\.Salda_TrvalePrikazy/.test(sqlText)) return tp;
      throw new Error('mock clb1: neočekávaný dotaz ' + sqlText);
    },
    async exec(sqlText, params) {
      calls.push({ name: 'clb1', sql: sqlText.replace(/\s+/g, ' ').trim(), params });
      if (/^\s*UPDATE/.test(sqlText)) { const r = tp.find(x => x.id === params.id && x.firma === params.firma); if (!r) return 0; Object.assign(r, { popis: params.popis, frekvence: params.frekvence, castka: params.castka, datum: params.datum }); return 1; }
      if (/^\s*DELETE/.test(sqlText)) { const n = tp.length; tp = tp.filter(x => !(x.id === params.id && x.firma === params.firma)); return n - tp.length; }
      throw new Error('mock clb1: neočekávaný exec ' + sqlText);
    },
  };
  return {
    calls,
    clb1,
    helios005: helios('Helios005', {
      '110': [{ nazev: 'Lékárna Baťov s.r.o.', saldo: -21703.52, splatnost: '2026-09-14', corg: 18, parovaci: '26009' }, { nazev: 'Malá', saldo: -129.95, splatnost: '2026-09-15', corg: 19, parovaci: '1' }],
      '210': [{ nazev: 'Česká správa\nInstitut Zlín', saldo: 1114, splatnost: '2026-07-20', corg: 217, parovaci: null }],
    }),
    helios004: helios('Helios004', {
      '110': [],
      '210': [{ nazev: 'ViVi', saldo: -1158.84, splatnost: '2026-06-30', corg: 75, parovaci: '230260005' }],
    }),
  };
}
const call = (h, method, path, body) => h(new Request('https://salda.test' + path, {
  method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }));

test('health', async () => {
  const h = createHandler({ dbs: mockDbs() });
  const r = await call(h, 'GET', '/api/health');
  assert.equal(r.status, 200); assert.equal((await r.json()).ok, true);
});

test('prehled: saldokonto z Heliosu (110/210, i položky do 500 Kč), TP z CLB1', async () => {
  const dbs = mockDbs();
  const h = createHandler({ dbs });
  const r = await call(h, 'GET', '/api/prehled');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.faktury.centrum.length, 2, 'i položka pod 500 Kč');
  assert.equal(j.faktury.centrum[0].castka, -21703.52);
  assert.equal(j.faktury.centrum[0].corg, '18');
  assert.equal(j.faktury.centrum[0].parovaci, '26009');
  assert.equal(j.odberatele.centrum[0].nazev, 'Česká správa — Institut Zlín');
  assert.equal(j.odberatele.datec[0].castka, -1158.84);
  assert.equal(j.tp.centrum.length, 1); assert.equal(j.tp.datec[0].firma, 'datec');
  const heliosCalls = dbs.calls.filter(c => /TabSaldo/.test(c.sql));
  assert.ok(heliosCalls.every(c => c.name !== 'clb1'), 'saldokonto jen z Heliosu');
  assert.deepEqual([...new Set(heliosCalls.map(c => c.params.skupina))].sort(), ['110', '210']);
  assert.ok(heliosCalls.every(c => /CisloOrg > 0/.test(c.sql) && /Saldo_Ucet <> 0/.test(c.sql) && !/500/.test(c.sql)));
  assert.ok(dbs.calls.filter(c => /Salda_TrvalePrikazy/.test(c.sql)).every(c => c.name === 'clb1'), 'TP jen z clb1');
});

test('prehled?cast=odberatele nečte faktury ani TP', async () => {
  const dbs = mockDbs();
  const h = createHandler({ dbs });
  const j = await (await call(h, 'GET', '/api/prehled?cast=odberatele')).json();
  assert.equal(j.faktury, undefined); assert.equal(j.tp, undefined); assert.ok(j.odberatele);
  assert.ok(!dbs.calls.some(c => c.params && c.params.skupina === '110'));
  assert.ok(!dbs.calls.some(c => /Salda_TrvalePrikazy/.test(c.sql)));
});

test('trvalé příkazy: vytvořit, upravit, smazat (parametrizovaně, firma se kontroluje)', async () => {
  const dbs = mockDbs();
  const h = createHandler({ dbs });
  let r = await call(h, 'POST', '/api/tp/centrum', { popis: 'Test', frekvence: 'Měsíční', castka: '1234.5', datum: '2026-10-01' });
  assert.equal(r.status, 201);
  let j = await r.json(); assert.equal(j.zaznam.id, 7); assert.equal(j.zaznam.castka, 1234.5); assert.equal(j.zaznam.firma, 'centrum');
  const ins = dbs.calls.find(c => /INSERT/.test(c.sql)); assert.ok(ins.sql.includes('@popis') && !ins.sql.includes('Test'));
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
  const h = createHandler({ dbs: mockDbs() });
  const j = await (await call(h, 'GET', '/api/diag')).json();
  assert.equal(j.spojeni.clb1.db, 'CLB1'); assert.equal(j.spojeni.helios005.db, 'Helios005');
  assert.equal(j.tabulky['centrum.dodavatele'].otevrenych, 2); assert.equal(j.tabulky.trvalePrikazy.radku, 2);
});

test('validateTp', () => {
  assert.deepEqual(validateTp({ popis: ' A ', frekvence: 'Měsíční', castka: '10.005', datum: '2026-01-31' }), { popis: 'A', frekvence: 'Měsíční', castka: 10.01, datum: '2026-01-31' });
  assert.throws(() => validateTp({ popis: 'A', frekvence: 'Měsíční', castka: 0, datum: '2026-01-31' }), /částku/);
  assert.throws(() => validateTp({ popis: 'A', frekvence: 'Měsíční', castka: 1, datum: '31.1.2026' }), /RRRR/);
});
