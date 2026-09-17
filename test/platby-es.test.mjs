// node --test test/  – Platby Španělsko: validace vstupu, dotaz jen do Helios004, mapování řádků
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/api.mjs';
import { validatePlatbyEs, PLATBY_ES_SQL, SUBJEKTY } from '../src/platby-es.mjs';

function mockDbs() {
  const calls = [];
  const rows = [
    { id: 65, klic: 'OLIN', typ: 'V', datum: '2026-08-05', castka: '61.00', mena: 'EUR ', castka_czk: 1475.59, nazev_banka: 'Olin ', nazev_ucto: 'OLIVENET NETWORK S.L.U.', zprava: '  ', popis: null, vs: '', ucet: '107-6522280297/0100', stav: 2 },
    { id: 70, klic: 'ENDESA', typ: 'V', datum: '2026-08-27', castka: 156.65, mena: 'EUR', castka_czk: null, nazev_banka: 'ENDESA ENERGIA, S.A.', nazev_ucto: '', zprava: '', popis: '', vs: '', ucet: '107-6522280297/0100', stav: 0 },
  ];
  const helios = (name) => ({
    name,
    async query(sqlText, params) {
      calls.push({ name, sql: sqlText, params });
      if (/FROM dbo\.TabBankVypisR/.test(sqlText)) return name === 'Helios004' ? rows.filter(r => !params.klic || r.klic === params.klic) : [];
      throw new Error('mock ' + name + ': neočekávaný dotaz');
    },
    async exec() { throw new Error('do Heliosu se nezapisuje'); },
  });
  return { calls, clb1: { async query() { throw new Error('clb1 se nepoužívá'); }, async exec() { throw new Error('x'); } }, helios005: helios('Helios005'), helios004: helios('Helios004') };
}
const call = (h, path) => h(new Request('https://salda.test' + path));

test('validatePlatbyEs: výchozí hodnoty, text z query stringu, chyby', () => {
  assert.deepEqual(validatePlatbyEs({}), { od: '2025-01-01', do: '2099-12-31', pocetPlateb: 2, pocetPrijmu: 5, klic: '' });
  assert.deepEqual(validatePlatbyEs({ od: '2024-01-01', pocetPlateb: '3', klic: 'olin' }), { od: '2024-01-01', do: '2099-12-31', pocetPlateb: 3, pocetPrijmu: 5, klic: 'OLIN' });
  assert.throws(() => validatePlatbyEs({ od: '1.1.2025' }), /RRRR-MM-DD/);
  assert.throws(() => validatePlatbyEs({ od: '2026-01-01', do: '2025-01-01' }), /později/);
  assert.throws(() => validatePlatbyEs({ pocetPlateb: '0' }), /1–50/);
  assert.throws(() => validatePlatbyEs({ klic: 'NEZNAMY' }), /Neznámý subjekt/);
});

test('SQL: subjekty a vzory jsou v dotazu, uživatelské hodnoty jen jako parametry', () => {
  for (const s of SUBJEKTY) { assert.ok(PLATBY_ES_SQL.includes(`N'${s.klic}'`)); for (const v of s.vzory) assert.ok(PLATBY_ES_SQL.includes(`N'${v}'`)); }
  for (const p of ['@od', '@do', '@klic', '@pocetPlateb', '@pocetPrijmu']) assert.ok(PLATBY_ES_SQL.includes(p), p);
  assert.ok(/TabBankVypisR/.test(PLATBY_ES_SQL) && /TabBankVypisRUhrady/.test(PLATBY_ES_SQL) && /TabCisOrg/.test(PLATBY_ES_SQL));
});

test('GET /api/platby-es: jen Helios004, parametry, mapování řádků', async () => {
  const dbs = mockDbs();
  const h = createHandler({ dbs });
  const r = await call(h, '/api/platby-es?od=2025-01-01&pocetPlateb=2');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.od, '2025-01-01'); assert.equal(j.pocetPlateb, 2); assert.equal(j.pocetPrijmu, 5); assert.equal(j.klic, '');
  assert.equal(j.subjekty.length, SUBJEKTY.length); assert.equal(j.subjekty[0].klic, 'OLIN'); assert.equal(j.subjekty.at(-1).typ, 'P');
  assert.equal(dbs.calls.length, 1); assert.equal(dbs.calls[0].name, 'Helios004');
  assert.deepEqual(dbs.calls[0].params, { od: '2025-01-01', do: '2099-12-31', pocetPlateb: 2, pocetPrijmu: 5, klic: '' });
  assert.equal(j.polozky.length, 2);
  assert.deepEqual(j.polozky[0], { id: 65, klic: 'OLIN', typ: 'V', datum: '2026-08-05', castka: 61, mena: 'EUR', castkaCzk: 1475.59, nazevBanka: 'Olin', nazevUcto: 'OLIVENET NETWORK S.L.U.', zprava: '', popis: '', vs: '', ucet: '107-6522280297/0100', stav: 2 });
  assert.equal(j.polozky[1].castkaCzk, null, 'nezaúčtovaný výpis nemá CZK');
});

test('GET /api/platby-es?klic=… vrací jen daný subjekt; chybný vstup → 400', async () => {
  const dbs = mockDbs();
  const h = createHandler({ dbs });
  const j = await (await call(h, '/api/platby-es?klic=endesa')).json();
  assert.equal(j.klic, 'ENDESA'); assert.equal(j.polozky.length, 1); assert.equal(dbs.calls[0].params.klic, 'ENDESA');
  const bad = await call(h, '/api/platby-es?od=2025-13-01');
  assert.equal(bad.status, 400); assert.match((await bad.json()).error, /RRRR-MM-DD/);
  assert.equal((await call(h, '/api/platby-es?klic=X')).status, 400);
});
