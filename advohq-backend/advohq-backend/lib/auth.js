/**
 * lib/auth.js
 * ───────────
 * JWT helpers using 'jose' (Edge-compatible, no Node crypto dep).
 *
 * Access  token: 15 min, stored in Authorization header (Bearer)
 * Refresh token: 7 days, stored in httpOnly cookie "advohq_rt"
 */

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { query, queryOne } from './db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const ACCESS_SECRET  = new TextEncoder().encode(process.env.JWT_SECRET);
const REFRESH_SECRET = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET);

const ACCESS_TTL  = '15m';
const REFRESH_TTL = '7d';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── Sign ──────────────────────────────────────────────────────────────────────

export async function signAccessToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(ACCESS_SECRET);
}

export async function signRefreshToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TTL)
    .sign(REFRESH_SECRET);
}

// ── Verify ────────────────────────────────────────────────────────────────────

export async function verifyAccessToken(token) {
  try {
    const { payload } = await jwtVerify(token, ACCESS_SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token) {
  try {
    const { payload } = await jwtVerify(token, REFRESH_SECRET);
    return payload;
  } catch {
    return null;
  }
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

const COOKIE_NAME = 'advohq_rt';

export function setRefreshCookie(token) {
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: REFRESH_TTL_MS / 1000,
  });
}

export function clearRefreshCookie() {
  cookies().set(COOKIE_NAME, '', { maxAge: 0, path: '/api/auth' });
}

export function getRefreshCookie() {
  return cookies().get(COOKIE_NAME)?.value ?? null;
}

// ── Token store (DB) ──────────────────────────────────────────────────────────

export async function storeRefreshToken(userId, rawToken) {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString();
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt]
  );
}

export async function rotateRefreshToken(userId, oldRaw, newRaw) {
  const oldHash = crypto.createHash('sha256').update(oldRaw).digest('hex');
  const newHash = crypto.createHash('sha256').update(newRaw).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString();

  // Delete old, insert new — atomic with two queries (good enough for Neon)
  await query(`DELETE FROM refresh_tokens WHERE token_hash = $1`, [oldHash]);
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, newHash, expiresAt]
  );
}

export async function revokeRefreshToken(rawToken) {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await query(`DELETE FROM refresh_tokens WHERE token_hash = $1`, [hash]);
}

export async function isRefreshTokenValid(userId, rawToken) {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const row = await queryOne(
    `SELECT id FROM refresh_tokens
     WHERE user_id = $1 AND token_hash = $2 AND expires_at > now()`,
    [userId, hash]
  );
  return !!row;
}

// ── Password helpers ──────────────────────────────────────────────────────────

export const hashPassword   = (pw) => bcrypt.hash(pw, 12);
export const comparePassword = (pw, hash) => bcrypt.compare(pw, hash);

// ── Extract caller identity from request ──────────────────────────────────────

export async function getAuthUser(request) {
  const header = request.headers.get('Authorization') ?? '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const payload = await verifyAccessToken(token);
  return payload; // { sub: userId, username, role } or null
}
