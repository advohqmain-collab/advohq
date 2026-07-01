/**
 * GET  /api/folders        — list folders for current user (?parent=<folderId>)
 * POST /api/folders        — create a new folder
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query, queryOne } from '@/lib/db';
import { withAuth, ok, created, err, corsHeaders } from '@/lib/api';

// ── GET ───────────────────────────────────────────────────────────────────────

export const GET = withAuth(async (request, _ctx, user) => {
  const url      = new URL(request.url);
  const parentId = url.searchParams.get('parent') || null;

  const conditions = ['owner_id = $1'];
  const params     = [user.sub];

  if (parentId) { conditions.push('parent_id = $2'); params.push(parentId); }
  else          { conditions.push('parent_id IS NULL'); }

  const rows = await query(
    `SELECT * FROM folders WHERE ${conditions.join(' AND ')} ORDER BY name ASC`,
    params
  );

  return ok({ folders: rows }, request);
});

// ── POST ──────────────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  name:     z.string().min(1).max(255),
  parentId: z.string().uuid().optional().nullable(),
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body   = await request.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.flatten().fieldErrors, request);

  const d = parsed.data;

  const row = await queryOne(
    `INSERT INTO folders (name, parent_id, owner_id)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [d.name, d.parentId ?? null, user.sub]
  );

  return created(row, request);
});

export const OPTIONS = (req) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });
