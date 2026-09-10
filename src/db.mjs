/**
 * Připojení k SQL Serveru – pojmenovaná spojení, každé s vlastním poolem (drží se v teplé instanci).
 *
 *   clb1       … CLB1 (trvalé příkazy)          – proměnné SQL_SERVER / SQL_USER / SQL_PASSWORD / SQL_DATABASE
 *   helios005  … Helios005 = Centrum (saldokonto) – DB_HELIOS005_DATABASE / _USER / _PASSWORD (server/port ze SQL_SERVER, SQL_PORT)
 *   helios004  … Helios004 = Datec (saldokonto)   – DB_HELIOS004_DATABASE / _USER / _PASSWORD
 *
 * Parametry vždy přes @nazev – hodnoty se nikdy nelepí do textu dotazu.
 */
import sql from 'mssql';

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const bool = (k, d) => { const v = env(k); return v === '' ? d : /^(1|true|yes|ano)$/i.test(v); };

export function dbConfig(name = 'clb1') {
  const key = String(name).toUpperCase();
  const P = 'DB_' + key + '_';
  const named = env(P + 'USER') !== '';
  const cfg = {
    server: env(P + 'SERVER', env('SQL_SERVER')),
    port: Number(env(P + 'PORT', env('SQL_PORT', '1433'))),
    database: named ? env(P + 'DATABASE', key === 'CLB1' ? 'CLB1' : key) : env('SQL_DATABASE', 'CLB1'),
    user: named ? env(P + 'USER') : (key === 'CLB1' ? env('SQL_USER') : ''),
    password: named ? env(P + 'PASSWORD') : (key === 'CLB1' ? env('SQL_PASSWORD') : ''),
    connectionTimeout: 15000,
    requestTimeout: Number(env('SQL_TIMEOUT_MS', '20000')),
    pool: { max: 4, min: 0, idleTimeoutMillis: 60000 },
    options: { encrypt: bool('SQL_ENCRYPT', true), trustServerCertificate: bool('SQL_TRUST_CERT', true), enableArithAbort: true, useUTC: false },
  };
  const missing = [];
  if (!cfg.server) missing.push('SQL_SERVER');
  if (!cfg.user) missing.push(key === 'CLB1' ? 'SQL_USER' : P + 'USER');
  if (!cfg.password) missing.push(key === 'CLB1' ? 'SQL_PASSWORD' : P + 'PASSWORD');
  if (missing.length) throw new Error(`Chybí nastavení spojení ${name} (${missing.join(', ')}) v proměnných prostředí.`);
  return cfg;
}

const pools = new Map();
function pool(name) {
  if (!pools.has(name)) {
    const p = new sql.ConnectionPool(dbConfig(name)).connect();
    p.catch(() => pools.delete(name));
    pools.set(name, p);
  }
  return pools.get(name);
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

export function connection(name) {
  return {
    name,
    /** SELECT → pole objektů */
    async query(text, params) {
      const p = await pool(name);
      const r = await bind(p.request(), params).query(text);
      return r.recordset || [];
    },
    /** INSERT/UPDATE/DELETE → počet ovlivněných řádků */
    async exec(text, params) {
      const p = await pool(name);
      const r = await bind(p.request(), params).query(text);
      return (r.rowsAffected || []).reduce((a, b) => a + b, 0);
    },
  };
}

/** Sada spojení, kterou dostává datová vrstva (viz salda.mjs) */
export const dbs = { clb1: connection('clb1'), helios005: connection('helios005'), helios004: connection('helios004') };
export const db = dbs.clb1;
