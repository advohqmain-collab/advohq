/**
 * lib/db.js
 * ─────────
 * Standard PostgreSQL connection pool using node-postgres (pg).
 * Compatible with Supabase, Neon, Railway, and any Postgres provider.
 *
 * Usage:
 *   import { query, queryOne } from '@/lib/db';
 *   const cases = await query('SELECT * FROM cases WHERE owner_id = $1', [userId]);
 */

import pkg from 'pg';

const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

/**
 * Execute a parameterised SQL query, return all rows.
 * @param {string} text   — SQL with $1, $2 … placeholders
 * @param {any[]}  params — bound parameters
 */
export async function query(text, params = []) {
  try {
    const result = await pool.query(text, params);
    return result.rows;
  } catch (err) {
    console.error('[db] query error', { text, params, err });
    throw err;
  }
}

/**
 * Execute a query and return the first row (or null).
 */
export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0] ?? null;
}

/**
 * Execute a query and return the first row or throw a 404-style error.
 */
export async function queryOneOrThrow(text, params = [], message = 'Not found') {
  const row = await queryOne(text, params);
  if (!row) {
    const err = new Error(message);
    err.status = 404;
    throw err;
  }
  return row;
}

export default pool;
