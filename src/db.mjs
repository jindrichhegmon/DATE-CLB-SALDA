/**
 * Připojení k SQL Serveru (CLB1). Jeden sdílený pool na teplou instanci funkce.
 * Parametry vždy přes @nazev – hodnoty se nikdy nelepí do textu dotazu.
 */
import sql from 'mssql';

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const bool = (k, d) => { const v = env(k); return v === '' ? d : /^(1|true|yes|ano)$/i.test(v); };

export function dbConfig() {
  const cfg = {
    server: env('SQL_SERVER'),
    port: Number(env('SQL_PORT', '1433')),
    database: env('SQL_DATABASE', 'CLB1'),
    user: env('SQL_USER'),
    password: env('SQL_PASSWORD'),
    connectionTimeout: 15000,
    requestTimeout: Number(env('SQL_TIMEOUT_MS', '20000')),
    pool: { max: 4, min: 0, idleTimeoutMillis: 60000 },
    options: { encrypt: bool('SQL_ENCRYPT', true), trustServerCertificate: bool('SQL_TRUST_CERT', true), enableArithAbort: true, useUTC: false },
  };
  const missing = ['server', 'user', 'password'].filter(k => !cfg[k]);
  if (missing.length) throw new Error('Chybí nastavení SQL (' + missing.map(k => 'SQL_' + k.toUpperCase()).join(', ') + ') v proměnných prostředí.');
  return cfg;
}

let poolPromise = null;
async function pool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(dbConfig()).connect();
    poolPromise.catch(() => { poolPromise = null; });
  }
  return poolPromise;
}

function bind(request, params) {
  for (const [k, v] of Object.entries(params || {})) {
    if (v instanceof Date) request.input(k, sql.DateTime2, v);
    else if (typeof v === 'number' && Number.isInteger(v)) request.input(k, sql.Int, v);
    else if (typeof v === 'number') request.input(k, sql.Decimal(18, 2), v);
    else if (typeof v === 'boolean') request.input(k, sql.Bit, v);
    else request.input(k, sql.NVarChar(sql.MAX), v === undefined ? null : v);
  }
  return request;
}

export const db = {
  /** SELECT → pole objektů */
  async query(text, params) {
    const p = await pool();
    const r = await bind(p.request(), params).query(text);
    return r.recordset || [];
  },
  /** INSERT/UPDATE/DELETE → počet ovlivněných řádků */
  async exec(text, params) {
    const p = await pool();
    const r = await bind(p.request(), params).query(text);
    return (r.rowsAffected || []).reduce((a, b) => a + b, 0);
  },
};
