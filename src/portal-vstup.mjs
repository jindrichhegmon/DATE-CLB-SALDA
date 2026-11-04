/**
 * Přístup jen přes DATEC Portál (stejný soubor ve všech chráněných agendách).
 * Prohlížeč posílá vstupenku z portálu v hlavičce x-portal-token. Tady se ověří u serveru portálu
 * (POST /api/datec-vstupenka {akce:'over'}); portál zkontroluje podpis, že vstupenka patří tomuto webu (aud),
 * a že je účet pořád aktivní a má na agendu právo. Kladný výsledek se pamatuje 5 minut, záporný 1 minutu.
 */
const PORTAL_API = () => (process.env.PORTAL_API || 'https://datec-portal.95-216-201-2.sslip.io').replace(/\/+$/, '');
const PAMET_OK_MS = 5 * 60e3, PAMET_NE_MS = 60e3;
const pamet = new Map();

/** @returns {Promise<{ok:true, uzivatel:object} | {ok:false, status:number, error:string}>} */
export async function overPortal(req, aud, { fetchFn = fetch, ted = Date.now } = {}) {
  const token = String(req.headers.get('x-portal-token') || '').trim();
  if (!token) return { ok: false, status: 401, error: 'Agenda se otevírá jen z DATEC Portálu.' };
  const p = pamet.get(token);
  if (p && p.do > ted()) return p.v;
  let r, j = {};
  try {
    r = await fetchFn(`${PORTAL_API()}/api/datec-vstupenka`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ akce: 'over', token, aud }), signal: AbortSignal.timeout(8000),
    });
    j = await r.json().catch(() => ({}));
  } catch {
    return { ok: false, status: 503, error: 'DATEC Portál neodpovídá, přístup teď nejde ověřit. Zkuste to za chvíli.' };
  }
  if (r.status >= 500) return { ok: false, status: 503, error: 'DATEC Portál neodpovídá, přístup teď nejde ověřit. Zkuste to za chvíli.' };
  const v = r.ok && j.ok ? { ok: true, uzivatel: j.uzivatel || {} } : { ok: false, status: r.status === 403 ? 403 : 401, error: j.chyba || 'Přístup nebyl ověřen. Otevřete agendu z DATEC Portálu.' };
  if (pamet.size > 1000) pamet.clear();
  pamet.set(token, { v, do: ted() + (v.ok ? PAMET_OK_MS : PAMET_NE_MS) });
  return v;
}
export const _vycistiPamet = () => pamet.clear();
