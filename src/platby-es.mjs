/**
 * Platby Španělsko – poslední platby španělským dodavatelům a příjmy od VIVI HOME
 * z bankovních výpisů DATEC v Heliosu (Helios004: dbo.TabBankVypisH + dbo.TabBankVypisR).
 *
 * Výpis má u každého pohybu název protistrany z banky (NazevOrg, Helios zkracuje na 20 znaků), zprávu pro
 * příjemce (PopisPlatby1–4), popis a přes úhrady (TabBankVypisRUhrady → TabCisOrg) i organizaci z účetnictví
 * – např. platba kartou „PRIME VISA“ spárovaná na GESTIÓN Y TÉCNICAS AGUA. Hledá se ve všech těchto polích.
 *
 * Bez `klic` vrací pro každý subjekt posledních N pohybů v období, s `klic` všechny pohyby jednoho subjektu
 * (výpis a export do Excelu). Uživatelské hodnoty jdou výhradně parametry (@od, @do, @klic, …).
 */

/** Subjekty v pořadí, v jakém se v reportu zobrazí. typ V = výdaj (platba dodavateli), P = příjem. */
export const SUBJEKTY = [
  { klic: 'OLIN',                    nazev: 'OLIN',                       popis: 'Olivenet Network — internet',                     typ: 'V', vzory: ['OLIN', '%OLIVENET%', '% OLIN%', 'OLIN %'] },
  { klic: 'SAGESA',                  nazev: 'SAGESA',                     popis: 'Servicios de administración y gestión',           typ: 'V', vzory: ['%SAGESA%'] },
  { klic: 'ENDESA',                  nazev: 'ENDESA',                     popis: 'Endesa Energía — elektřina',                      typ: 'V', vzory: ['%ENDESA%'] },
  { klic: 'AZUL',                    nazev: 'AZUL',                       popis: '',                                                typ: 'V', vzory: ['%AZUL%'] },
  { klic: 'GESTAGUA',                nazev: 'GESTAGUA',                   popis: 'Gestión y Técnicas Agua — voda (GESAGUA)',        typ: 'V', vzory: ['%GESTAGUA%', '%GESAGUA%', '%GESTI% AGUA%', '%TECNICAS AGUA%'] },
  { klic: 'ACOSOL',                  nazev: 'Acosol',                     popis: 'Acosol S.A. — voda a kanalizace',                 typ: 'V', vzory: ['%ACOSOL%'] },
  { klic: 'RMF',                     nazev: 'RMF Andalusian Management',  popis: 'správa nemovitosti',                              typ: 'V', vzory: ['%RMF%ANDALUSIAN%', '%ANDALUSIAN MANAG%'] },
  { klic: 'GRAN MARBELLA',           nazev: 'Gran Marbella Consulting',   popis: '',                                                typ: 'V', vzory: ['%GRAN MARBELLA%', '%MARBELLA CONSUL%'] },
  { klic: 'AYUNTAMIENTO MIJAS',      nazev: 'Ayuntamiento de Mijas',      popis: 'radnice Mijas — daně a poplatky',                 typ: 'V', vzory: ['%AYUNTAMIENTO%MIJA%', '%AYTO%MIJA%', '%AYUDAMIENTO%MIJA%'] },
  { klic: 'AYUNTAMIENTO FUENGIROLA', nazev: 'Ayuntamiento de Fuengirola', popis: 'radnice Fuengirola — daně a poplatky',            typ: 'V', vzory: ['%AYUNTAMIENTO%FUEN%', '%AYTO%FUEN%', '%AYUDAMIENTO%FUEN%'] },
  { klic: 'VIVI HOME',               nazev: 'VIVI HOME',                  popis: 'ViVi Holiday Homes — příjmy z pronájmu',          typ: 'P', vzory: ['%VIVI%'] },
];

export const OD_VYCHOZI = '2025-01-01';
const DO_VYCHOZI = '2099-12-31';
const MAX_RADKU = 1000;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

/** Konstanty ze SUBJEKTY se vkládají do SQL jako literály (nejde o uživatelský vstup); apostrofy se zdvojí. */
const lit = (s) => String(s).replace(/'/g, "''");

function sestavSql() {
  const subjekty = SUBJEKTY.map((s, i) => `(N'${lit(s.klic)}', '${s.typ}', ${i + 1})`).join(',\n    ');
  const vzory = SUBJEKTY.flatMap(s => s.vzory.map(v => `(N'${lit(s.klic)}', N'${lit(v)}')`)).join(',\n    ');
  return `
WITH s AS (SELECT * FROM (VALUES
    ${subjekty}) x(klic, typ, poradi)),
p AS (SELECT * FROM (VALUES
    ${vzory}) x(klic, vzor)),
b AS (
  SELECT r.ID, CONVERT(varchar(10), r.DatumSplatnosti, 120) AS datum, h.CisloUctu + '/' + h.KodBanky AS ucet, h.Mena AS mena_uctu,
    r.KodUctovani, r.Castka AS castka, r.CastkaHM AS castka_czk, r.Mena AS mena, r.Stav AS stav,
    LTRIM(RTRIM(ISNULL(r.NazevOrg, ''))) AS nazev_banka,
    LTRIM(RTRIM(CONCAT(r.PopisPlatby1, ' ', r.PopisPlatby2, ' ', r.PopisPlatby3, ' ', r.PopisPlatby4))) AS zprava,
    LTRIM(RTRIM(ISNULL(r.Popis, ''))) AS popis, ISNULL(r.VariabilniSymbol, '') AS vs,
    ISNULL((SELECT STRING_AGG(x.n, ', ') FROM (SELECT DISTINCT REPLACE(REPLACE(LTRIM(RTRIM(o.Nazev)), CHAR(13), ''), CHAR(10), '') AS n
                                             FROM dbo.TabBankVypisRUhrady u JOIN dbo.TabCisOrg o ON o.CisloOrg = u.CisloOrg WHERE u.IDRadek = r.ID) x), '') AS nazev_ucto
  FROM dbo.TabBankVypisR r JOIN dbo.TabBankVypisH h ON h.ID = r.IDHlava
  WHERE r.DatumSplatnosti >= @od AND r.DatumSplatnosti < DATEADD(day, 1, CONVERT(date, @do))
),
r AS (
  SELECT s.klic, s.typ, s.poradi, b.*, ROW_NUMBER() OVER (PARTITION BY s.klic ORDER BY b.datum DESC, b.ID DESC) AS rn
  FROM s JOIN b ON b.KodUctovani = CASE WHEN s.typ = 'P' THEN 2 ELSE 1 END
    AND EXISTS (SELECT 1 FROM p WHERE p.klic = s.klic AND (b.nazev_banka LIKE p.vzor OR b.zprava LIKE p.vzor OR b.popis LIKE p.vzor OR b.nazev_ucto LIKE p.vzor))
  WHERE @klic = '' OR s.klic = @klic
)
SELECT TOP (${MAX_RADKU}) klic, typ, datum, castka, mena, castka_czk, nazev_banka, nazev_ucto, zprava, popis, vs, ucet, stav, ID AS id
FROM r WHERE @klic <> '' OR rn <= CASE WHEN typ = 'P' THEN @pocetPrijmu ELSE @pocetPlateb END
ORDER BY poradi, datum DESC, ID DESC`;
}

export const PLATBY_ES_SQL = sestavSql();

const bad = (m) => Object.assign(new Error(m), { status: 400 });
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const text = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

/** Ověří a doplní vstup (hodnoty z query stringu jsou text). */
export function validatePlatbyEs(input = {}) {
  const od = text(input.od) || OD_VYCHOZI;
  const doD = text(input.do) || DO_VYCHOZI;
  if (!DATUM.test(od) || Number.isNaN(Date.parse(od))) throw bad('Období od musí být ve tvaru RRRR-MM-DD.');
  if (!DATUM.test(doD) || Number.isNaN(Date.parse(doD))) throw bad('Období do musí být ve tvaru RRRR-MM-DD.');
  if (od > doD) throw bad('Období od je později než období do.');
  const pocet = (v, d, co) => {
    if (v == null || text(v) === '') return d;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 50) throw bad(`${co} musí být celé číslo 1–50.`);
    return n;
  };
  const pocetPlateb = pocet(input.pocetPlateb, 2, 'Počet plateb');
  const pocetPrijmu = pocet(input.pocetPrijmu, 5, 'Počet příjmů');
  const klic = text(input.klic).toUpperCase();
  if (klic && !SUBJEKTY.some(s => s.klic === klic)) throw bad(`Neznámý subjekt "${klic}". Známé: ${SUBJEKTY.map(s => s.klic).join(', ')}.`);
  return { od, do: doD, pocetPlateb, pocetPrijmu, klic };
}

/** @param {{ helios004: { query } }} dbs */
export async function platbyEs(dbs, input) {
  const v = validatePlatbyEs(input);
  const rows = await dbs.helios004.query(PLATBY_ES_SQL, { od: v.od, do: v.do, pocetPlateb: v.pocetPlateb, pocetPrijmu: v.pocetPrijmu, klic: v.klic });
  return {
    generovano: new Date().toISOString(),
    zdroj: 'Helios004 (DATEC) – bankovní výpisy dbo.TabBankVypisR',
    ...v,
    subjekty: SUBJEKTY.map(({ klic, nazev, popis, typ }) => ({ klic, nazev, popis, typ })),
    polozky: (rows || []).map(r => ({
      id: r.id,
      klic: r.klic,
      typ: r.typ,
      datum: r.datum,
      castka: num(r.castka),
      mena: text(r.mena),
      castkaCzk: num(r.castka_czk),          // null = výpis ještě není zaúčtován (Stav 0)
      nazevBanka: text(r.nazev_banka),       // protistrana podle banky (zkráceno na 20 znaků)
      nazevUcto: text(r.nazev_ucto),         // organizace z účetnictví (spárovaná úhrada), může být prázdné
      zprava: text(r.zprava),                // zpráva pro příjemce
      popis: text(r.popis),
      vs: text(r.vs),
      ucet: text(r.ucet),
      stav: r.stav == null ? null : Number(r.stav),
    })),
  };
}
