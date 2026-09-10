/**
 * Datová vrstva aplikace Salda.
 * Všechny funkce dostávají sadu spojení `dbs` = { clb1, helios005, helios004 } (každé { query, exec }),
 * aby šly testovat bez databáze.
 *
 *   Saldokonto (jen čtení) – přímo z Heliosu:
 *     Helios005 = Centrum, Helios004 = Datec: dbo.TabSaldo (jeden řádek na fakturu a saldokontní skupinu)
 *     + dbo.TabCisOrg (název organizace). Skupina 110 = dodavatelé tuzemsko, 210 = odběratelé tuzemsko.
 *     Neuhrazená položka = Saldo_Ucet <> 0 (Saldo_Ucet = MD − Dal, u dodavatelů záporné). Bez prahu částky.
 *     Řádky bez organizace (CisloOrg <= 0, souhrnné/počáteční zůstatky) se vynechávají.
 *   Trvalé příkazy a pravidelné příjmy – CLB1: dbo.Salda_TrvalePrikazy (sql/001_trvale_prikazy.sql)
 */

export const FIRMY = {
  centrum: { kod: 'CLB',   nazev: 'Centrum', helios: 'helios005' },
  datec:   { kod: 'DATEC', nazev: 'Datec',   helios: 'helios004' },
};
export const SKUPINY = { dodavatele: '110', odberatele: '210' };
export const FREKVENCE = ['Měsíční', 'Čtvrtletní', 'Pololetní', 'Roční', 'Týdenní', '14 dní', 'Jednorázově'];
const TP = 'dbo.Salda_TrvalePrikazy';

const SALDO_SQL = `
  SELECT LTRIM(RTRIM(ISNULL(o.Nazev, N''))) AS nazev,
         s.Saldo_Ucet AS saldo,
         CONVERT(char(10), s.DatumSplatno, 23) AS splatnost,
         s.CisloOrg AS corg,
         s.ParovaciZnak AS parovaci
  FROM dbo.TabSaldo s
  LEFT JOIN dbo.TabCisOrg o ON o.CisloOrg = s.CisloOrg
  WHERE s.CisloSalSk = @skupina AND s.Saldo_Ucet <> 0 AND s.CisloOrg > 0
  ORDER BY s.DatumSplatno, o.Nazev`;

const tpSql = `
  SELECT Id AS id, Firma AS firma, Popis AS popis, Frekvence AS frekvence, Castka AS castka,
         CONVERT(char(10), DatumPlatby, 23) AS datum, Zmeneno AS zmeneno
  FROM ${TP}`;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const oneLine = (s) => String(s || '').replace(/\s*[\r\n]+\s*/g, ' — ').trim();
const saldoRow = (r) => ({ nazev: oneLine(r.nazev) || '(bez názvu)', castka: num(r.saldo), splatnost: r.splatnost || null, corg: r.corg == null ? null : String(r.corg), parovaci: r.parovaci ? String(r.parovaci).trim() : null });
const tpRow = (r) => ({ id: Number(r.id), firma: r.firma === 'DATEC' ? 'datec' : 'centrum', popis: r.popis, frekvence: r.frekvence, castka: num(r.castka), datum: r.datum, zmeneno: r.zmeneno || null });

export function firmaKey(v) {
  const k = String(v || '').toLowerCase();
  if (!FIRMY[k]) throw Object.assign(new Error('Neznámá firma – použijte centrum nebo datec.'), { status: 400 });
  return k;
}

async function saldo(dbs, skupina) {
  const out = {};
  for (const [key, f] of Object.entries(FIRMY)) out[key] = (await dbs[f.helios].query(SALDO_SQL, { skupina })).map(saldoRow);
  return out;
}

/** Diagnostika: kam jsme připojeni a kolik řádků zdroje mají (pro ladění nasazení) */
export async function diagnostika(dbs) {
  const out = { spojeni: {} };
  for (const name of ['clb1', 'helios005', 'helios004']) {
    try {
      const i = (await dbs[name].query('SELECT DB_NAME() AS db, @@SERVERNAME AS server, SUSER_SNAME() AS login'))[0] || {};
      out.spojeni[name] = { ok: true, ...i };
    } catch (e) { out.spojeni[name] = { ok: false, chyba: e.originalError?.message || e.message }; }
  }
  out.tabulky = {};
  for (const [key, f] of Object.entries(FIRMY)) {
    for (const [what, sk] of Object.entries(SKUPINY)) {
      try {
        const r = (await dbs[f.helios].query('SELECT COUNT(*) AS n, SUM(CASE WHEN Saldo_Ucet <> 0 AND CisloOrg > 0 THEN 1 ELSE 0 END) AS otevrenych FROM dbo.TabSaldo WHERE CisloSalSk = @skupina', { skupina: sk }))[0] || {};
        out.tabulky[`${key}.${what}`] = { zdroj: `${f.helios}.TabSaldo skupina ${sk}`, radku: Number(r.n || 0), otevrenych: Number(r.otevrenych || 0) };
      } catch (e) { out.tabulky[`${key}.${what}`] = { zdroj: `${f.helios}.TabSaldo skupina ${sk}`, chyba: e.originalError?.message || e.message }; }
    }
  }
  try { const tp = (await dbs.clb1.query(`SELECT COUNT(*) AS n FROM ${TP}`))[0] || {}; out.tabulky.trvalePrikazy = { zdroj: 'clb1.' + TP, radku: Number(tp.n || 0) }; }
  catch (e) { out.tabulky.trvalePrikazy = { zdroj: 'clb1.' + TP, chyba: e.originalError?.message || e.message }; }
  return out;
}

/** Neuhrazené faktury dodavatelů obou firem (období filtruje frontend) */
export const faktury = (dbs) => saldo(dbs, SKUPINY.dodavatele);
/** Pohledávky za odběrateli obou firem */
export const odberatele = (dbs) => saldo(dbs, SKUPINY.odberatele);

/** Trvalé příkazy obou firem */
export async function trvalePrikazy(dbs) {
  const out = { centrum: [], datec: [] };
  for (const r of await dbs.clb1.query(`${tpSql} ORDER BY Firma, Popis, DatumPlatby`)) { const row = tpRow(r); out[row.firma].push(row); }
  return out;
}

export function validateTp(input) {
  const popis = String(input.popis ?? '').trim();
  const frekvence = String(input.frekvence ?? '').trim();
  const castka = Number(input.castka);
  const datum = String(input.datum ?? '').trim();
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  if (!popis) throw bad('Vyplňte popis.');
  if (popis.length > 300) throw bad('Popis je příliš dlouhý (max. 300 znaků).');
  if (!frekvence || frekvence.length > 40) throw bad('Vyplňte frekvenci.');
  if (!Number.isFinite(castka) || castka === 0) throw bad('Zadejte nenulovou částku (kladná = výdaj, záporná = příjem).');
  if (Math.abs(castka) > 1e12) throw bad('Částka je mimo rozsah.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || Number.isNaN(Date.parse(datum))) throw bad('Datum platby musí být ve tvaru RRRR-MM-DD.');
  return { popis, frekvence, castka: Math.round(castka * 100) / 100, datum };
}

export async function tpCreate(dbs, firma, input) {
  const kod = FIRMY[firmaKey(firma)].kod;
  const v = validateTp(input);
  const rows = await dbs.clb1.query(
    `INSERT INTO ${TP} (Firma, Popis, Frekvence, Castka, DatumPlatby) OUTPUT INSERTED.Id AS id VALUES (@firma, @popis, @frekvence, @castka, @datum)`,
    { firma: kod, ...v });
  const id = Number(rows[0]?.id);
  const saved = await dbs.clb1.query(`${tpSql} WHERE Id = @id`, { id });
  return saved[0] ? tpRow(saved[0]) : { id, firma: firmaKey(firma), ...v };
}

export async function tpUpdate(dbs, firma, id, input) {
  const kod = FIRMY[firmaKey(firma)].kod;
  const v = validateTp(input);
  const n = await dbs.clb1.exec(
    `UPDATE ${TP} SET Popis = @popis, Frekvence = @frekvence, Castka = @castka, DatumPlatby = @datum, Zmeneno = SYSDATETIME() WHERE Id = @id AND Firma = @firma`,
    { id: Number(id), firma: kod, ...v });
  if (!n) throw Object.assign(new Error(`Trvalý příkaz #${id} nebyl nalezen.`), { status: 404 });
  const saved = await dbs.clb1.query(`${tpSql} WHERE Id = @id`, { id: Number(id) });
  return saved[0] ? tpRow(saved[0]) : { id: Number(id), firma: firmaKey(firma), ...v };
}

export async function tpDelete(dbs, firma, id) {
  const kod = FIRMY[firmaKey(firma)].kod;
  const n = await dbs.clb1.exec(`DELETE FROM ${TP} WHERE Id = @id AND Firma = @firma`, { id: Number(id), firma: kod });
  if (!n) throw Object.assign(new Error(`Trvalý příkaz #${id} nebyl nalezen.`), { status: 404 });
  return { id: Number(id), smazano: true };
}
