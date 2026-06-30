/**
 * GET /api/cases/:id/download
 * ───────────────────────────
 * Returns a time-limited pre-signed S3 GET URL for secure file download.
 */

import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getDownloadUrl } from '@/lib/storage';
import { withAuth, ok, err, corsHeaders } from '@/lib/api';

export const GET = withAuth(async (request, { params }, user) => {
  const c = await queryOne(
    `SELECT id, name, s3_key FROM cases WHERE id = $1 AND owner_id = $2`,
    [params.id, user.sub]
  );
  if (!c) return err('Case not found', request, 404);
  if (!c.s3_key) return err('No file attached to this case', request, 404);

  const url = await getDownloadUrl(c.s3_key, c.name);
  return ok({ downloadUrl: url }, request);
});

export const OPTIONS = (req) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });
