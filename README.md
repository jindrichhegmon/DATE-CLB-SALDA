# Salda — Centrum & Datec

Nová samostatná aplikace: přehled závazků (faktury dodavatelů + trvalé příkazy s kalendářem plateb),
pohledávek za odběrateli a editace trvalých příkazů. Čte **přímo z SQL Serveru CLB1**, bez Make i Softr.

- **Frontend:** `public/index.html` (jeden soubor, bez knihoven).
- **Backend:** Netlify Function `netlify/functions/api.mjs` → `src/api.mjs` (HTTP vrstva) → `src/salda.mjs` (dotazy) → `src/db.mjs` (mssql pool).
  Frontend i API běží na stejném webu, CORS se neřeší.
- **Přístup:** uživatel zadá jednou přístupový klíč aplikace (`APP_KEY`), prohlížeč si ho pamatuje a posílá v hlavičce `x-app-key`.
  Heslo k databázi je jen v proměnných prostředí Netlify.

## Data
| Co | Tabulka (CLB1) | Poznámka |
|---|---|---|
| Faktury dodavatelů | `dbo.CLBSaldoDO`, `dbo.DATECSaldoDO` | Název, Saldo 1, Datum splatnosti (DMR) – jen čtení |
| Odběratelé | `dbo.CLBSaldoOD`, `dbo.DATECSaldoOD` | jen čtení; po/ve splatnosti podle dnešního data |
| Trvalé příkazy | `dbo.Salda_TrvalePrikazy` | `sql/001_trvale_prikazy.sql`; kladná částka = výdaj, záporná = příjem |

Kalendář plateb: faktury podle splatnosti, trvalé příkazy rozepsané podle frekvence (týdenní, 14 dní, měsíční,
čtvrtletní, pololetní, roční, jednorázově) do zvoleného období, počínaje dneškem.

## API (vše kromě /api/health s hlavičkou x-app-key)
```
GET    /api/health
GET    /api/prehled?cast=dodavatele|odberatele|vse
GET    /api/tp
POST   /api/tp/:firma            {popis, frekvence, castka, datum}     firma = centrum | datec
PUT    /api/tp/:firma/:id        {popis, frekvence, castka, datum}
DELETE /api/tp/:firma/:id
```

## Nasazení (Netlify)
1. Netlify projekt `datec-salda` propojit s tímto repozitářem (Site configuration → Build & deploy → Link repository).
   Build command a functions jsou v `netlify.toml`; `npm install` proběhne automaticky (závislost `mssql`).
2. Proměnné prostředí (viz `.env.example`): `SQL_SERVER`, `SQL_PORT`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD`,
   `SQL_ENCRYPT`, `SQL_TRUST_CERT`, `SQL_TIMEOUT_MS`, `APP_KEY`.
3. Ověření: `https://datec-salda.netlify.app/api/health` → `{"ok":true}`; pak otevřít web a zadat `APP_KEY`.

SQL Server musí přijímat spojení na portu 1433 z internetu (Netlify nemá pevnou IP) – stejně jako dnes u Make.

## Vývoj a testy
```
npm install
npm test                      # API + datová vrstva s mockem databáze
node test/dev-server.mjs      # http://127.0.0.1:8787, klíč "test-key", data z mocku (bez SQL Serveru)
npx netlify dev               # skutečné funkce proti SQL (vyžaduje .env)
```
