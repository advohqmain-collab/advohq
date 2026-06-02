/**
 * GET  /api/cases        — list cases for current user
 * POST /api/cases        — create a new case
 *
 * Query params (GET):
 *   ?trashed=true        — list trashed cases
 *   ?folder=<folderId>   — filter by folder
 *   ?search=<text>       — name search
 *   ?page=1&limit=50
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query, queryOne } from '@/lib/db';
import { withAuth, ok, created, err, parsePagination, corsHeaders } from '@/lib/api';

// ── GET ───────────────────────────────────────────────────────────────────────

export const GET = withAuth(async (request, _ctx, user) => {
  const url    = new URL(request.url);
  const trashed = url.searchParams.get('trashed') === 'true';
  const folderId = url.searchParams.get('folder') || null;
  const search   = url.searchParams.get('search')  || null;
  const { limit, offset } = parsePagination(request.url);

  const conditions = ['c.owner_id = $1', `c.is_trashed = $2`];
  const params     = [user.sub, trashed];
  let i = 3;

  if (folderId) { conditions.push(`c.folder_id = $${i++}`); params.push(folderId); }
  else if (!trashed) { conditions.push(`c.folder_id IS NULL`); }

  if (search) {
    conditions.push(`c.name ILIKE $${i++}`);
    params.push(`%${search}%`);
  }

  const where = conditions.join(' AND ');

  const rows = await query(
    `SELECT
       c.id, c.name, c.client_name, c.file_type,
       c.stage_id, c.custom_stage,
       c.assigned_to, c.next_date, c.end_date, c.end_time,
       c.tags, c.file_size, c.s3_key,
       c.is_trashed, c.trashed_at,
       c.created_at, c.updated_at,
       f.name AS folder_name
     FROM cases c
     LEFT JOIN folders f ON f.id = c.folder_id
     WHERE ${where}
     ORDER BY c.updated_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset]
  );

  // Total count for pagination
  const countRow = await queryOne(
    `SELECT count(*)::int AS total FROM cases c WHERE ${where}`,
    params
  );

  return ok({ cases: rows, total: countRow?.total ?? 0, limit, offset }, request);
});

// ── POST ──────────────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  name:        z.string().min(1).max(255),
  clientName:  z.string().optional(),
  fileType:    z.enum(['pdf','docx','xlsx','pptx','img','txt','folder']).default('pdf'),
  stageId:     z.number().int().min(-1).max(7).default(0),
  customStage: z.string().optional(),
  assignedTo:  z.string().optional(),
  nextDate:    z.string().optional().nullable(),
  endDate:     z.string().optional().nullable(),
  endTime:     z.string().optional().nullable(),
  tags:        z.array(z.string()).default([]),
  folderId:    z.string().uuid().optional().nullable(),
  fileSize:    z.number().int().positive().optional(),
  s3Key:       z.string().optional(),
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body   = await request.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.flatten().fieldErrors, request);

  const d = parsed.data;

  const row = await queryOne(
    `INSERT INTO cases
       (name, client_name, file_type, stage_id, custom_stage,
        assigned_to, next_date, end_date, end_time,
        tags, folder_id, owner_id, file_size, s3_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      d.name, d.clientName ?? null, d.fileType,
      d.stageId, d.customStage ?? null,
      d.assignedTo ?? null,
      d.nextDate ?? null, d.endDate ?? null, d.endTime ?? null,
      d.tags, d.folderId ?? null, user.sub,
      d.fileSize ?? null, d.s3Key ?? null,
    ]
  );

  return created(row, request);
});

export const OPTIONS = (req) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });
