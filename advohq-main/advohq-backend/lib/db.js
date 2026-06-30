/**
 * lib/db.js
 * Supabase / standard PostgreSQL using node-postgres (pg).
 */

import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

export async function query(text, params = []) {
  try {
    const result = await pool.query(text, params);
    return result.rows;
  } catch (err) {
    console.error('[db] query error', { text, params, err });
    throw err;
  }
}

export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0] ?? null;
}

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
