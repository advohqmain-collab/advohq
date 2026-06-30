/**
 * POST /api/auth/logout
 * ─────────────────────
 * Revokes the refresh token and clears the cookie.
 */

import { NextResponse }    from 'next/server';
import { getRefreshCookie, verifyRefreshToken, revokeRefreshToken, clearRefreshCookie } from '@/lib/auth';
import { ok, withError, corsHeaders } from '@/lib/api';

async function handler(request) {
  const raw = getRefreshCookie();
  if (raw) {
    const payload = await verifyRefreshToken(raw);
    if (payload) await revokeRefreshToken(raw);
    clearRefreshCookie();
  }
  return ok({ message: 'Logged out' }, request);
}

export const POST    = withError(handler);
export const OPTIONS = (req) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });
