/**
 * POST /api/auth/register
 * ────────────────────────
 * Body: { username, email, fullName, password }
 * Creates a new user account, then auto-logs them in.
 * Returns: { accessToken, user }
 * Sets:    httpOnly cookie "advohq_rt" (refresh token)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne, query } from '@/lib/db';
import {
  hashPassword, signAccessToken, signRefreshToken,
  setRefreshCookie, storeRefreshToken,
} from '@/lib/auth';
import { ok, err, withError, corsHeaders } from '@/lib/api';

const Schema = z.object({
  username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/, 'Username may only contain letters, numbers, _ . -'),
  email:    z.string().email(),
  fullName: z.string().min(1).max(100),
  password: z.string().min(6).max(128),
});

async function handler(request) {
  const body = await request.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.errors[0]?.message || 'Invalid input';
    return err(msg, request, 400);
  }

  const { username, email, fullName, password } = parsed.data;

  // Check username not already taken (case-insensitive)
  const existingUser = await queryOne(
    `SELECT id FROM users WHERE lower(username) = lower($1)`,
    [username]
  );
  if (existingUser) return err('Username is already taken', request, 409);

  // Check email not already registered
  const existingEmail = await queryOne(
    `SELECT id FROM users WHERE lower(email) = lower($1)`,
    [email]
  );
  if (existingEmail) return err('Email is already registered', request, 409);

  // Hash password and create user
  const passwordHash = await hashPassword(password);

  const newUser = await queryOne(
    `INSERT INTO users (username, email, full_name, password_hash, role, created_at)
     VALUES ($1, $2, $3, $4, 'member', now())
     RETURNING id, username, email, full_name, role`,
    [username.toLowerCase(), email.toLowerCase(), fullName, passwordHash]
  );

  if (!newUser) return err('Failed to create account', request, 500);

  // Auto-login: build tokens
  const payload = { sub: newUser.id, username: newUser.username, role: newUser.role ?? 'member' };
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(payload),
    signRefreshToken(payload),
  ]);

  await storeRefreshToken(newUser.id, refreshToken);
  setRefreshCookie(refreshToken);

  return ok(
    {
      accessToken,
      user: {
        id:       newUser.id,
        username: newUser.username,
        email:    newUser.email,
        fullName: newUser.full_name,
        role:     newUser.role,
      },
    },
    request
  );
}

export const POST    = withError(handler);
export const OPTIONS = (req) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });
