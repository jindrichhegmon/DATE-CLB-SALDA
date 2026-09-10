/**
 * HTTP vrstva (Netlify Functions v2: Request → Response), oddělená od Netlify kvůli testům.
 *
 *   GET    /api/health
 *   GET    /api/diag                                      → databáze, server, počty řádků tabulek
 *   GET    /api/prehled?cast=dodavatele|odberatele|vse   → { faktury, odberatele, tp, generovano }
 *   GET    /api/tp                                        → { tp }
 *   POST   /api/tp/:firma                                 { popis, frekvence, castka, datum } → { zaznam }
 *   PUT    /api/tp/:firma/:id                             { popis, frekvence, castka, datum } → { zaznam }
 *   DELETE /api/tp/:firma/:id                             → { id, smazano }
 *
 * Bez přihlášení – data nejsou tajná. Frontend i funkce jsou na stejném webu, takže CORS není potřeba.
 */
import * as salda from './salda.mjs';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

async function body(req) {
  try { return await req.json(); } catch { throw Object.assign(new Error('Tělo požadavku musí být JSON.'), { status: 400 }); }
}

/** @param {{ dbs: {clb1,helios005,helios004} }} deps – sada spojení, viz db.mjs */
export function createHandler({ dbs }) {
  return async function handle(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');
    const method = req.method.toUpperCase();

    if (path === '/api/health') return json({ ok: true, cas: new Date().toISOString() });

    try {
      if (path === '/api/prehled' && method === 'GET') {
        const cast = url.searchParams.get('cast') || 'vse';
        const out = { generovano: new Date().toISOString(), cast };
        if (cast !== 'odberatele') { out.faktury = await salda.faktury(dbs); out.tp = await salda.trvalePrikazy(dbs); }
        if (cast !== 'dodavatele') out.odberatele = await salda.odberatele(dbs);
        return json({ ok: true, ...out });
      }
      if (path === '/api/tp' && method === 'GET') return json({ ok: true, tp: await salda.trvalePrikazy(dbs) });
      if (path === '/api/diag' && method === 'GET') return json({ ok: true, ...(await salda.diagnostika(dbs)) });

      const m = path.match(/^\/api\/tp\/(centrum|datec)(?:\/(\d+))?$/);
      if (m) {
        const [, firma, id] = m;
        if (method === 'POST' && !id) return json({ ok: true, zaznam: await salda.tpCreate(dbs, firma, await body(req)) }, 201);
        if (method === 'PUT' && id) return json({ ok: true, zaznam: await salda.tpUpdate(dbs, firma, id, await body(req)) });
        if (method === 'DELETE' && id) return json({ ok: true, ...(await salda.tpDelete(dbs, firma, id)) });
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
