/**
 * GET    /api/cases/:id   — get single case
 * PATCH  /api/cases/:id   — update case fields
 * DELETE /api/cases/:id   — soft-delete (trash) or hard-delete if already trashed
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query, queryOne } from '@/lib/db';
import { deleteObject } from '@/lib/storage';
import { withAuth, ok, noContent, notFound, forbidden, err, corsHeaders } from '@/lib/api';

// ── owner guard ───────────────────────────────────────────────────────────────

async function getOwnedCase(caseId, userId) {
  const c = await queryOne(`SELECT * FROM cases WHERE id = $1`, [caseId]);
  if (!c) { const e = new Error('Case not found'); e.status = 404; throw e; }
  if (c.owner_id !== userId) { const e = new Error('Forbidden'); e.status = 403; throw e; }
  return c;
}

// ── GET ───────────────────────────────────────────────────────────────────────

export const GET = withAuth(async (request, { params }, user) => {
  const c = await getOwnedCase(params.id, user.sub);
  return ok(c, request);
});

// ── PATCH ─────────────────────────────────────────────────────────────────────

const UpdateSchema = z.object({
  name:        z.string().min(1).max(255).optional(),
  clientName:  z.string().optional().nullable(),
  fileType:    z.enum(['pdf','docx','xlsx','pptx','img','txt','folder']).optional(),
  stageId:     z.number().int().min(-1).max(7).optional(),
  customStage: z.string().optional().nullable(),
  assignedTo:  z.string().optional().nullable(),
  nextDate:    z.string().optional().nullable(),
  endDate:     z.string().optional().nullable(),
  endTime:     z.string().optional().nullable(),
  caseNo:      z.string().optional().nullable(),
  hall:        z.string().optional().nullable(),
  court:       z.string().optional().nullable(),
  notes:       z.string().optional().nullable(),
  tags:        z.array(z.string()).optional(),
  folderId:    z.string().uuid().optional().nullable(),
  isTrash:     z.boolean().optional(),   // true = move to trash, false = restore
  s3Key:       z.string().optional().nullable(),
  fileSize:    z.number().int().positive().optional().nullable(),
}).strict();

export const PATCH = withAuth(async (request, { params }, user) => {
  await getOwnedCase(params.id, user.sub);

  const body   = await request.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.flatten().fieldErrors, request);

  const d = parsed.data;
  const sets = [];
  const vals = [];
  let i = 1;

  const map = {
    name:        'name',
    clientName:  'client_name',
    fileType:    'file_type',
    stageId:     'stage_id',
    customStage: 'custom_stage',
    assignedTo:  'assigned_to',
    nextDate:    'next_date',
    endDate:     'end_date',
    endTime:     'end_time',
    caseNo:      'case_no',
    hall:        'hall',
    court:       'court',
    notes:       'notes',
    tags:        'tags',
    folderId:    'folder_id',
    s3Key:       's3_key',
    fileSize:    'file_size',
  };

  for (const [jsKey, col] of Object.entries(map)) {
    if (jsKey in d) { sets.push(`${col} = $${i++}`); vals.push(d[jsKey]); }
  }

  // Trash handling
  if ('isTrash' in d) {
    sets.push(`is_trashed = $${i++}`);
    vals.push(d.isTrash);
    sets.push(`trashed_at = $${i++}`);
    vals.push(d.isTrash ? new Date().toISOString() : null);
  }

  if (sets.length === 0) return err('No fields to update', request);

  vals.push(params.id);
  const updated = await queryOne(
    `UPDATE cases SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  );

  return ok(updated, request);
});

// ── DELETE ────────────────────────────────────────────────────────────────────

export const DELETE = withAuth(async (request, { params }, user) => {
  const c = await getOwnedCase(params.id, user.sub);

  if (c.is_trashed) {
    // Hard delete — also remove S3 object
    if (c.s3_key) {
      await deleteObject(c.s3_key).catch(e => console.warn('S3 delete failed', e));
    }
    await query(`DELETE FROM cases WHERE id = $1`, [params.id]);
  } else {
    // Soft delete — move to trash
    await query(
      `UPDATE cases SET is_trashed = true, trashed_at = now() WHERE id = $1`,
      [params.id]
    );
  }

  return noContent(request);
});

export const OPTIONS = (req) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });
