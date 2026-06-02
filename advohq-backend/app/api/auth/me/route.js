/**
 * GET /api/auth/me
 * ────────────────
 * Returns the authenticated user's profile.
 */

import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { withAuth, ok, notFound, corsHeaders } from '@/lib/api';

const handler = withAuth(async (request, _ctx, authUser) => {
  const user = await queryOne(
    `SELECT id, username, email, full_name, role, avatar_initials, created_at
     FROM users WHERE id = $1`,
    [authUser.sub]
  );
  if (!user) return notFound(request);
  return ok(user, request);
});

export const GET     = handler;
export const OPTIONS = (req) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });
