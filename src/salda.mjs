/**
 * Datová vrstva aplikace Salda – čte saldokonto CLB1 a spravuje trvalé příkazy.
 * Všechny funkce dostávají `db` ({ query, exec }) jako parametr, aby šly testovat bez databáze.
 *
 *   CLBSaldoDO / DATECSaldoDO … neuhrazené faktury dodavatelů (závazky)   – jen čtení
 *   CLBSaldoOD / DATECSaldoOD … pohledávky za odběrateli                  – jen čtení
 *   Salda_TrvalePrikazy       … trvalé příkazy a pravidelné příjmy (sql/001_trvale_prikazy.sql)
 */

export const FIRMY = {
  centrum: { kod: 'CLB',   nazev: 'Centrum', faktury: 'dbo.CLBSaldoDO',   odberatele: 'dbo.CLBSaldoOD' },
  datec:   { kod: 'DATEC', nazev: 'Datec',   faktury: 'dbo.DATECSaldoDO', odberatele: 'dbo.DATECSaldoOD' },
};
export const FREKVENCE = ['Měsíční', 'Čtvrtletní', 'Pololetní', 'Roční', 'Týdenní', '14 dní', 'Jednorázově'];
const TP = 'dbo.Salda_TrvalePrikazy';

/* [Datum splatnosti (DMR)] je text, jak ho zapíše importní skript podle národního nastavení Windows:
   "09/21/2026 00:00:00" (americký), "21.09.2026 0:00:00" (český) nebo "2026-09-21" (ISO).
   Formát se pozná podle oddělovače, aby se u dnů do 12 neprohodil den a měsíc. Ven jde "YYYY-MM-DD". */
const DATUM_SQL = `CASE
    WHEN LTRIM(RTRIM(ISNULL([Datum splatnosti (DMR)], ''))) = '' THEN NULL
    WHEN [Datum splatnosti (DMR)] LIKE '%.%' THEN TRY_CONVERT(datetime, [Datum splatnosti (DMR)], 104)
    WHEN [Datum splatnosti (DMR)] LIKE '%/%' THEN TRY_CONVERT(datetime, [Datum splatnosti (DMR)], 101)
    ELSE COALESCE(TRY_CONVERT(datetime, [Datum splatnosti (DMR)], 120), TRY_CONVERT(datetime, [Datum splatnosti (DMR)], 126)) END`;
const saldoSql = (table) => `
  SELECT LTRIM(RTRIM(ISNULL([Název], N''))) AS nazev,
         [Saldo 1] AS saldo,
         CONVERT(char(10), ${DATUM_SQL}, 23) AS splatnost,
         [Č# org#] AS corg
  FROM ${table}
  WHERE [Saldo 1] IS NOT NULL AND [Saldo 1] <> 0
  ORDER BY ${DATUM_SQL}, [Název]`;

const tpSql = `
  SELECT Id AS id, Firma AS firma, Popis AS popis, Frekvence AS frekvence, Castka AS castka,
         CONVERT(char(10), DatumPlatby, 23) AS datum, Zmeneno AS zmeneno
  FROM ${TP}`;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const oneLine = (s) => String(s || '').replace(/\s*[\r\n]+\s*/g, ' — ').trim();
const saldoRow = (r) => ({ nazev: oneLine(r.nazev) || '(bez názvu)', castka: num(r.saldo), splatnost: r.splatnost || null, corg: r.corg == null ? null : String(r.corg) });
const tpRow = (r) => ({ id: Number(r.id), firma: r.firma === 'DATEC' ? 'datec' : 'centrum', popis: r.popis, frekvence: r.frekvence, castka: num(r.castka), datum: r.datum, zmeneno: r.zmeneno || null });

export function firmaKey(v) {
  const k = String(v || '').toLowerCase();
  if (!FIRMY[k]) throw Object.assign(new Error('Neznámá firma – použijte centrum nebo datec.'), { status: 400 });
  return k;
}

/** Diagnostika: kam jsme připojeni a kolik řádků tabulky mají (pro ladění nasazení) */
export async function diagnostika(db) {
  const info = (await db.query('SELECT DB_NAME() AS db, @@SERVERNAME AS server, SUSER_SNAME() AS login, SYSDATETIME() AS cas'))[0] || {};
  const tabulky = {};
  for (const [key, f] of Object.entries(FIRMY)) {
    for (const [what, t] of [['faktury', f.faktury], ['odberatele', f.odberatele]]) {
      const r = (await db.query(`SELECT COUNT(*) AS n, SUM(CASE WHEN [Saldo 1] IS NOT NULL AND [Saldo 1] <> 0 THEN 1 ELSE 0 END) AS nenulove FROM ${t}`))[0] || {};
      tabulky[`${key}.${what}`] = { tabulka: t, radku: Number(r.n || 0), nenulovych: Number(r.nenulove || 0) };
    }
  }
  const tp = (await db.query(`SELECT COUNT(*) AS n FROM ${TP}`))[0] || {};
  tabulky.trvalePrikazy = { tabulka: TP, radku: Number(tp.n || 0) };
  return { ...info, tabulky };
}

/** Faktury dodavatelů obou firem (celé saldokonto; období filtruje frontend) */
export async function faktury(db) {
  const out = {};
  for (const [key, f] of Object.entries(FIRMY)) out[key] = (await db.query(saldoSql(f.faktury))).map(saldoRow);
  return out;
}

/** Pohledávky za odběrateli obou firem */
export async function odberatele(db) {
  const out = {};
  for (const [key, f] of Object.entries(FIRMY)) out[key] = (await db.query(saldoSql(f.odberatele))).map(saldoRow);
  return out;
}

/** Trvalé příkazy obou firem */
export async function trvalePrikazy(db) {
  const out = { centrum: [], datec: [] };
  for (const r of await db.query(`${tpSql} ORDER BY Firma, Popis, DatumPlatby`)) { const row = tpRow(r); out[row.firma].push(row); }
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

export async function tpCreate(db, firma, input) {
  const kod = FIRMY[firmaKey(firma)].kod;
  const v = validateTp(input);
  const rows = await db.query(
    `INSERT INTO ${TP} (Firma, Popis, Frekvence, Castka, DatumPlatby) OUTPUT INSERTED.Id AS id VALUES (@firma, @popis, @frekvence, @castka, @datum)`,
    { firma: kod, ...v });
  const id = Number(rows[0]?.id);
  const saved = await db.query(`${tpSql} WHERE Id = @id`, { id });
  return saved[0] ? tpRow(saved[0]) : { id, firma: firmaKey(firma), ...v };
}

export async function tpUpdate(db, firma, id, input) {
  const kod = FIRMY[firmaKey(firma)].kod;
  const v = validateTp(input);
  const n = await db.exec(
    `UPDATE ${TP} SET Popis = @popis, Frekvence = @frekvence, Castka = @castka, DatumPlatby = @datum, Zmeneno = SYSDATETIME() WHERE Id = @id AND Firma = @firma`,
    { id: Number(id), firma: kod, ...v });
  if (!n) throw Object.assign(new Error(`Trvalý příkaz #${id} nebyl nalezen.`), { status: 404 });
  const saved = await db.query(`${tpSql} WHERE Id = @id`, { id: Number(id) });
  return saved[0] ? tpRow(saved[0]) : { id: Number(id), firma: firmaKey(firma), ...v };
}

export async function tpDelete(db, firma, id) {
  const kod = FIRMY[firmaKey(firma)].kod;
  const n = await db.exec(`DELETE FROM ${TP} WHERE Id = @id AND Firma = @firma`, { id: Number(id), firma: kod });
  if (!n) throw Object.assign(new Error(`Trvalý příkaz #${id} nebyl nalezen.`), { status: 404 });
  return { id: Number(id), smazano: true };
}
