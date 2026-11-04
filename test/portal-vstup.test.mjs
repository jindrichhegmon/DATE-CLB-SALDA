// Přístup jen přes DATEC Portál: bez platné vstupenky API nevydá data (src/portal-vstup.mjs).
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { overPortal, _vycistiPamet } from '../src/portal-vstup.mjs';
import { createHandler } from '../src/api.mjs';

const req = (token) => new Request('https://agenda.test/api/tp', { headers: token ? { 'x-portal-token': token } : {} });
const portal = (status, body) => { const volani = []; const f = async (url, init) => { volani.push({ url, telo: JSON.parse(init.body) }); return new Response(JSON.stringify(body), { status }); }; f.volani = volani; return f; };
beforeEach(() => _vycistiPamet());

test('bez vstupenky se portál ani nevolá', async () => {
  const f = portal(200, { ok: true });
  const v = await overPortal(req(''), 'agenda.test', { fetchFn: f });
  assert.equal(v.ok, false); assert.equal(v.status, 401); assert.equal(f.volani.length, 0);
});
test('platnou vstupenku potvrdí portál a výsledek se pamatuje', async () => {
  const f = portal(200, { ok: true, uzivatel: { login: 'ucto' } });
  assert.equal((await overPortal(req('abc.def'), 'agenda.test', { fetchFn: f })).uzivatel.login, 'ucto');
  assert.deepEqual(f.volani[0].telo, { akce: 'over', token: 'abc.def', aud: 'agenda.test' });
  await overPortal(req('abc.def'), 'agenda.test', { fetchFn: f });
  assert.equal(f.volani.length, 1);
});
test('odmítnutí portálu i nedostupný portál data nepustí', async () => {
  assert.equal((await overPortal(req('x.y'), 'agenda.test', { fetchFn: portal(403, { chyba: 'Přístup už neplatí' }) })).status, 403);
  _vycistiPamet();
  assert.equal((await overPortal(req('x.y'), 'agenda.test', { fetchFn: async () => { throw new Error('ECONNREFUSED'); } })).status, 503);
  assert.equal((await overPortal(req('x.y'), 'agenda.test', { fetchFn: portal(500, {}) })).status, 503);
});
test('API agendy bez vstupenky odpoví 401 a databáze se nedotkne', async () => {
  const handle = createHandler({ dbs: new Proxy({}, { get() { throw new Error("databáze se nemá volat"); } }), pristup: (r) => overPortal(r, 'agenda.test', { fetchFn: portal(401, { chyba: 'Neplatná vstupenka' }) }) });
  const r = await handle(req('spatna.vstupenka'));
  assert.equal(r.status, 401);
  assert.equal((await r.json()).portal, true);
  const bez = await handle(req(''));
  assert.equal(bez.status, 401);
});
