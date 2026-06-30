/**
 * GET  /api/cases/:id/annotations  — list annotations on a case file
 * POST /api/cases/:id/annotations  — add annotation (highlight / comment)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query, queryOne } from '@/lib/db';
import { withAuth, ok, created, err, corsHeaders } from '@/lib/api';

export const GET = withAuth(async (request, { params }, user) => {
  // Verify case ownership
  const c = await queryOne(
    `SELECT id FROM cases WHERE id = $1 AND owner_id = $2`,
    [params.id, user.sub]
  );
  if (!c) return err('Case not found', request, 404);

  const rows = await query(
    `SELECT a.*, u.full_name AS author_name, u.avatar_initials
     FROM annotations a
     JOIN users u ON u.id = a.author_id
     WHERE a.case_id = $1
     ORDER BY a.created_at ASC`,
    [params.id]
  );

  return ok(rows, request);
});

const CreateSchema = z.object({
  pageNumber: z.number().int().min(1).default(1),
  annType:    z.enum(['highlight','comment','underline']).default('highlight'),
  color:      z.string().default('#FFD700'),
  content:    z.string().optional().nullable(),
  x:          z.number().optional().nullable(),
  y:          z.number().optional().nullable(),
  width:      z.number().optional().nullable(),
  height:     z.number().optional().nullable(),
});

export const POST = withAuth(async (request, { params }, user) => {
  const c = await queryOne(
    `SELECT id FROM cases WHERE id = $1 AND owner_id = $2`,
    [params.id, user.sub]
  );
  if (!c) return err('Case not found', request, 404);

  const body   = await request.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.flatten().fieldErrors, request);

  const d = parsed.data;

  const row = await queryOne(
    `INSERT INTO annotations
       (case_id, author_id, page_number, ann_type, color, content, x, y, width, height)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      params.id, user.sub,
      d.pageNumber, d.annType, d.color,
      d.content ?? null,
      d.x ?? null, d.y ?? null, d.width ?? null, d.height ?? null,
    ]
  );

  return created(row, request);
});

export const OPTIONS = (req) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });
