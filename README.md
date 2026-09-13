# Salda — Centrum & Datec

Nová samostatná aplikace: přehled závazků (faktury dodavatelů + trvalé příkazy s kalendářem plateb),
pohledávek za odběrateli a editace trvalých příkazů. Saldokonto čte **přímo z Heliosu** (Helios005 = Centrum,
Helios004 = Datec), trvalé příkazy z CLB1. Bez Make, Softr i exportů do Excelu.

- **Frontend:** `public/index.html` (jeden soubor, bez knihoven).
- **Backend:** `server.mjs` (Node, VPS) → `src/api.mjs` (HTTP vrstva) → `src/salda.mjs` (dotazy) → `src/db.mjs` (mssql pool).
  Frontend i API běží na stejné adrese, CORS se neřeší.
- **Přístup:** bez přihlášení (data nejsou tajná). Heslo k databázi je jen v proměnných prostředí Netlify;
  aplikace umí jen číst saldokonto a upravovat trvalé příkazy.

## Data
| Co | Zdroj | Poznámka |
|---|---|---|
| Faktury dodavatelů | Helios `dbo.TabSaldo` skupina 110 + `dbo.TabCisOrg` | `Saldo_Ucet <> 0`, `CisloOrg > 0`, bez prahu částky; Saldo_Ucet = MD − Dal (u dodavatelů záporné) |
| Odběratelé | Helios `dbo.TabSaldo` skupina 210 + `dbo.TabCisOrg` | po/ve splatnosti podle `DatumSplatno` a dnešního data |
| Trvalé příkazy | CLB1 `dbo.Salda_TrvalePrikazy` | `sql/001_trvale_prikazy.sql`; kladná částka = výdaj, záporná = příjem |

Helios se jen čte (login s právem čtení), zapisuje se pouze do tabulky trvalých příkazů v CLB1.

Kalendář plateb: faktury podle splatnosti, trvalé příkazy rozepsané podle frekvence (týdenní, 14 dní, měsíční,
čtvrtletní, pololetní, roční, jednorázově) do zvoleného období, počínaje dneškem.

## API
```
GET    /api/health
GET    /api/prehled?cast=dodavatele|odberatele|vse
GET    /api/tp
POST   /api/tp/:firma            {popis, frekvence, castka, datum}     firma = centrum | datec
PUT    /api/tp/:firma/:id        {popis, frekvence, castka, datum}
DELETE /api/tp/:firma/:id
```

## Nasazení

### Varianta A – VPS 95.216.201.2 (doporučeno: pevná IP, kterou firewall SQL Serveru pouští)
Aplikace běží jako samostatný Node server (`server.mjs`, port 3091) za Caddy, vedle jhn-apps.
1. Jednorázově na VPS: `mkdir -p /opt/datec-salda`, vytvořit `/opt/datec-salda/.env` podle `.env.example`
   (SQL_*, DB_HELIOS00x_* a `PORT=3091`), do `/etc/caddy/Caddyfile` přidat blok z `deploy/Caddyfile.snippet` a `systemctl reload caddy`.
2. Z Macu ve složce projektu: `./deploy/vps-deploy.sh` (rsync, `npm install`, pm2 start/restart, kontrola `/api/health`).
3. Web: `https://salda.95-216-201-2.sslip.io` (nebo vlastní doména z Caddyfile).

### Varianta B – Netlify jako průčelí (projekt `datec-salda`, propojený s tímto repozitářem)
Netlify nemá pevnou odchozí IP a firewall SQL Serveru ho nepustí, proto Netlify jen servíruje `public/`
a volání `/api/*` přeposílá na VPS (`[[redirects]]` v `netlify.toml`). Web tak funguje i na `datec-salda.netlify.app`,
ale data vždy tečou přes VPS. Kód Netlify funkce je v `netlify/functions-sql` (nepoužívá se).
1. Netlify projekt `datec-salda` propojit s tímto repozitářem (Site configuration → Build & deploy → Link repository).
   Build command a functions jsou v `netlify.toml`; `npm install` proběhne automaticky (závislost `mssql`).
2. Proměnné prostředí (viz `.env.example`): `SQL_SERVER`, `SQL_PORT`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD`,
   `SQL_ENCRYPT`, `SQL_TRUST_CERT`, `SQL_TIMEOUT_MS` a pro Helios `DB_HELIOS005_*`, `DB_HELIOS004_*`.
3. Ověření: `https://datec-salda.netlify.app/api/health` → `{"ok":true}`; pak otevřít web.


## Vývoj a testy
```
npm install
npm test                      # API + datová vrstva s mockem databáze
node test/dev-server.mjs      # http://127.0.0.1:8787, data z mocku (bez SQL Serveru)
npm start                     # samostatný server proti SQL (vyžaduje .env), http://127.0.0.1:3091
```

## Verze – jak poznat, že běží poslední
- V patičce stránky je řádek `web v1.1.0 (datum) · server v1.1.0 (commit …, nasazeno …, běží od …) ✓`.
  Web = verze stránky z Netlify, server = verze Node serveru na VPS (`/api/health`). Když se liší, řádek zčervená
  s textem „verze webu a serveru se liší“ – po změně kódu je potřeba nasadit obě strany (push do `main` + `./deploy/vps-deploy.sh`).
- Verze se zvyšuje v `package.json` a v konstantě `WEB_VERZE` v patičce stránky (stejné číslo).
- `deploy/vps-deploy.sh` zapíše `verze.json` (commit, větev, čas nasazení), server ji vrací v `/api/health`.
