/**
 * POST /api/files/presigned
 * ─────────────────────────
 * Step 1 of the upload flow:
 *   1. Client calls this route → gets a pre-signed S3 PUT URL + the s3Key
 *   2. Client PUTs the file directly to S3 using the URL
 *   3. Client calls PATCH /api/cases/:id to save { s3Key, fileSize }
 *
 * Body: { caseId, filename, mimeType, fileSize }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne } from '@/lib/db';
import { buildKey, getUploadUrl } from '@/lib/storage';
import { withAuth, ok, err, corsHeaders } from '@/lib/api';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

const Schema = z.object({
  caseId:   z.string().uuid(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE, 'File too large (max 100 MB)'),
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body   = await request.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return err(parsed.error.flatten().fieldErrors, request);

  const { caseId, filename, mimeType, fileSize } = parsed.data;

  // Confirm case ownership
  const c = await queryOne(
    `SELECT id FROM cases WHERE id = $1 AND owner_id = $2`,
    [caseId, user.sub]
  );
  if (!c) return err('Case not found', request, 404);

  const key        = buildKey(caseId, filename);
  const uploadUrl  = await getUploadUrl(key, mimeType);

  return ok({ uploadUrl, s3Key: key }, request);
});

export const OPTIONS = (req) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });
