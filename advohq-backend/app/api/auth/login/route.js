/**
 * POST /api/auth/login
 * ────────────────────
 * Body: { username, password }
 * Returns: { accessToken, user }
 * Sets:    httpOnly cookie "advohq_rt" (refresh token)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne } from '@/lib/db';
import {
  comparePassword, signAccessToken, signRefreshToken,
  setRefreshCookie, storeRefreshToken,
} from '@/lib/auth';
import { ok, err, withError, corsHeaders } from '@/lib/api';

const Schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

async function handler(request) {
  const body = await request.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return err('username and password are required', request);

  const { username, password } = parsed.data;

  // Find user (case-insensitive username)
  const user = await queryOne(
    `SELECT id, username, email, full_name, role, password_hash
     FROM users WHERE lower(username) = lower($1)`,
    [username]
  );

  if (!user) return err('Invalid credentials', request, 401);

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) return err('Invalid credentials', request, 401);

  // Build tokens
  const payload = { sub: user.id, username: user.username, role: user.role };
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(payload),
    signRefreshToken(payload),
  ]);

  // Persist hashed refresh token
  await storeRefreshToken(user.id, refreshToken);

  // Set refresh cookie
  setRefreshCookie(refreshToken);

  return ok(
    {
      accessToken,
      user: {
        id:       user.id,
        username: user.username,
        email:    user.email,
        fullName: user.full_name,
        role:     user.role,
      },
    },
    request
  );
}

export const POST    = withError(handler);
export const OPTIONS = (req) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });
