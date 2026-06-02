/**
 * POST /api/auth/refresh
 * ──────────────────────
 * Uses the httpOnly refresh cookie to issue a new access token.
 * Also rotates the refresh token (refresh-token rotation pattern).
 */

import { NextResponse } from 'next/server';
import {
  getRefreshCookie, verifyRefreshToken,
  signAccessToken, signRefreshToken,
  rotateRefreshToken, setRefreshCookie,
  isRefreshTokenValid,
} from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { ok, err, withError, corsHeaders } from '@/lib/api';

async function handler(request) {
  const raw = getRefreshCookie();
  if (!raw) return err('No refresh token', request, 401);

  const payload = await verifyRefreshToken(raw);
  if (!payload) return err('Invalid refresh token', request, 401);

  const valid = await isRefreshTokenValid(payload.sub, raw);
  if (!valid) return err('Refresh token revoked or expired', request, 401);

  // Re-fetch user to ensure account is still active
  const user = await queryOne(
    `SELECT id, username, role FROM users WHERE id = $1`,
    [payload.sub]
  );
  if (!user) return err('User not found', request, 401);

  const newPayload = { sub: user.id, username: user.username, role: user.role };
  const [accessToken, newRefresh] = await Promise.all([
    signAccessToken(newPayload),
    signRefreshToken(newPayload),
  ]);

  await rotateRefreshToken(user.id, raw, newRefresh);
  setRefreshCookie(newRefresh);

  return ok({ accessToken }, request);
}

export const POST    = withError(handler);
export const OPTIONS = (req) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });
