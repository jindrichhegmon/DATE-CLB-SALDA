// Lokální server pro ruční i automatické testy bez SQL Serveru: public/ + /api přes skutečný handler nad mock databází.
//   node test/dev-server.mjs [port]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../src/api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const d = (off) => { const x = new Date(); x.setDate(x.getDate() + off); return x.toISOString().slice(0, 10); };
let seq = 10;
let tp = [
  { id: 1, firma: 'CLB', popis: 'ALZA NEO MOBILY IPHONE', frekvence: 'Měsíční', castka: 3575, datum: d(-40), zmeneno: null },
  { id: 2, firma: 'CLB', popis: 'Nájem příjem', frekvence: 'Měsíční', castka: -5000, datum: d(1), zmeneno: null },
  { id: 3, firma: 'CLB', popis: 'Jednorázová', frekvence: 'Jednorázově', castka: 100, datum: d(-1), zmeneno: null },
  { id: 4, firma: 'DATEC', popis: 'BMW X1', frekvence: 'Čtvrtletní', castka: 15654.79, datum: d(3), zmeneno: null },
];
const saldo = {
  helios005: { '110': [{ nazev: 'Lékárna Baťov s.r.o.', saldo: -21703.52, splatnost: d(4), corg: 18, parovaci: '26009' }, { nazev: 'Michal Drobný', saldo: -10800, splatnost: d(400), corg: 215, parovaci: '1' }, { nazev: 'Drobná faktura', saldo: -129.95, splatnost: d(6), corg: 300, parovaci: '2' }],
               '210': [{ nazev: 'Vojenská zdravotní pojišťovna', saldo: 5569, splatnost: '2025-02-28', corg: 32, parovaci: null }, { nazev: 'Mgr. Lenka Popovská', saldo: 3500, splatnost: d(20), corg: 40, parovaci: null }, { nazev: 'ViVi Holiday Homes SL', saldo: -1158.84, splatnost: d(-5), corg: 41, parovaci: null }] },
  helios004: { '110': [{ nazev: 'Pražská energetika, a.s.', saldo: -13037, splatnost: d(10), corg: 5, parovaci: '19160850' }],
               '210': [{ nazev: 'Centrum pro léčbu bolesti', saldo: 31500, splatnost: d(30), corg: 2, parovaci: null }] },
};
const helios = (name) => ({
  async query(sqlText, params) {
    if (/SELECT DB_NAME\(\)/.test(sqlText)) return [{ db: name, server: 'MOCK', login: 'ro' }];
    if (/SELECT COUNT\(\*\)/.test(sqlText)) return [{ n: 10, otevrenych: saldo[name.toLowerCase()][params.skupina].length }];
    if (/FROM dbo\.TabSaldo/.test(sqlText)) return saldo[name.toLowerCase()][params.skupina] || [];
    throw new Error('mock: neočekávaný dotaz ' + sqlText);
  },
  async exec() { throw new Error('mock: do Heliosu se nezapisuje'); },
});
const clb1 = {
  async query(sqlText, params) {
    if (/SELECT DB_NAME\(\)/.test(sqlText)) return [{ db: 'CLB1', server: 'MOCK', login: 'clb1_app' }];
    if (/SELECT COUNT\(\*\)/.test(sqlText)) return [{ n: tp.length }];
    if (/^\s*INSERT INTO dbo\.Salda_TrvalePrikazy/.test(sqlText)) { const id = seq++; tp.push({ id, firma: params.firma, popis: params.popis, frekvence: params.frekvence, castka: params.castka, datum: params.datum, zmeneno: null }); return [{ id }]; }
    if (/WHERE Id = @id/.test(sqlText)) return tp.filter(r => r.id === params.id);
    if (/FROM dbo\.Salda_TrvalePrikazy/.test(sqlText)) return tp;
    throw new Error('mock: neočekávaný dotaz ' + sqlText);
  },
  async exec(sqlText, params) {
    if (/^\s*UPDATE/.test(sqlText)) { const r = tp.find(x => x.id === params.id && x.firma === params.firma); if (!r) return 0; Object.assign(r, { popis: params.popis, frekvence: params.frekvence, castka: params.castka, datum: params.datum }); return 1; }
    if (/^\s*DELETE/.test(sqlText)) { const n = tp.length; tp = tp.filter(x => !(x.id === params.id && x.firma === params.firma)); return n - tp.length; }
    throw new Error('mock: neočekávaný exec ' + sqlText);
  },
};
const mockDbs = { clb1, helios005: helios('Helios005'), helios004: helios('Helios004') };
const handle = createHandler({ dbs: mockDbs });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + req.headers.host);
  if (url.pathname.startsWith('/api')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : null;
    const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end('not found'); }
});
const port = Number(process.argv[2] || process.env.PORT || 8787);
server.listen(port, '127.0.0.1', () => console.log(`dev server http://127.0.0.1:${port}`));
