/**
 * HTTP vrstva (Netlify Functions v2: Request → Response), oddělená od Netlify kvůli testům.
 *
 *   GET    /api/health
 *   GET    /api/prehled?cast=dodavatele|odberatele|vse   → { faktury, odberatele, tp, generovano }
 *   GET    /api/tp                                        → { tp }
 *   POST   /api/tp/:firma                                 { popis, frekvence, castka, datum } → { zaznam }
 *   PUT    /api/tp/:firma/:id                             { popis, frekvence, castka, datum } → { zaznam }
 *   DELETE /api/tp/:firma/:id                             → { id, smazano }
 *
 * Každé volání kromě /api/health musí mít hlavičku x-app-key rovnou APP_KEY (přístupový klíč aplikace).
 * Frontend i funkce jsou na stejném webu, takže CORS není potřeba.
 */
import { timingSafeEqual } from 'node:crypto';
import * as salda from './salda.mjs';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

function keyOk(req, expected) {
  const given = req.headers.get('x-app-key') || '';
  if (!expected || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function body(req) {
  try { return await req.json(); } catch { throw Object.assign(new Error('Tělo požadavku musí být JSON.'), { status: 400 }); }
}

/** @param {{ db: {query,exec}, appKey: string }} deps */
export function createHandler({ db, appKey }) {
  return async function handle(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');
    const method = req.method.toUpperCase();

    if (path === '/api/health') return json({ ok: true, cas: new Date().toISOString() });
    if (!appKey) return json({ ok: false, error: 'Na serveru není nastaven APP_KEY.' }, 500);
    if (!keyOk(req, appKey)) return json({ ok: false, error: 'Neplatný přístupový klíč.' }, 401);

    try {
      if (path === '/api/prehled' && method === 'GET') {
        const cast = url.searchParams.get('cast') || 'vse';
        const out = { generovano: new Date().toISOString(), cast };
        if (cast !== 'odberatele') { out.faktury = await salda.faktury(db); out.tp = await salda.trvalePrikazy(db); }
        if (cast !== 'dodavatele') out.odberatele = await salda.odberatele(db);
        return json({ ok: true, ...out });
      }
      if (path === '/api/tp' && method === 'GET') return json({ ok: true, tp: await salda.trvalePrikazy(db) });

      const m = path.match(/^\/api\/tp\/(centrum|datec)(?:\/(\d+))?$/);
      if (m) {
        const [, firma, id] = m;
        if (method === 'POST' && !id) return json({ ok: true, zaznam: await salda.tpCreate(db, firma, await body(req)) }, 201);
        if (method === 'PUT' && id) return json({ ok: true, zaznam: await salda.tpUpdate(db, firma, id, await body(req)) });
        if (method === 'DELETE' && id) return json({ ok: true, ...(await salda.tpDelete(db, firma, id)) });
      }
      return json({ ok: false, error: 'Neznámá cesta nebo metoda.' }, 404);
    } catch (e) {
      const status = e.status || 500;
      const msg = e.originalError?.message || e.message || String(e);
      const pretty = status >= 500 && /ETIMEOUT|ESOCKET|ECONNREFUSED|Failed to connect/i.test(msg + (e.code || ''))
        ? 'SQL Server je nedostupný: ' + msg : msg;
      if (status >= 500) console.error('[salda]', method, path, msg);
      return json({ ok: false, error: pretty }, status);
    }
  };
}
