/**
 * GET    /api/folders/:id   — get single folder
 * PATCH  /api/folders/:id   — rename / move folder
 * DELETE /api/folders/:id   — delete folder (subfolders cascade, cases inside are orphaned to root)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query, queryOne } from '@/lib/db';
import { withAuth, ok, noContent, err, corsHeaders } from '@/lib/api';

async function getOwnedFolder(folderId, userId) {
  const f = await queryOne(`SELECT * FROM folders WHERE id = $1`, [folderId]);
  if (!f) { const e = new Error('Folder not found'); e.status = 404; throw e; }
  if (f.owner_id !== userId) { const e = new Error('Forbidden'); e.status = 403; throw e; }
  return f;
}

export const GET = withAuth(async (request, { params }, user) => {
  const f = await getOwnedFolder(params.id, user.sub);
  return ok(f, request);
});

const UpdateSchema = z.object({
  name:     z.string().min(1).max(255).optional(),
  parentId: z.string().uuid().optional().nullable(),
}).strict();

export const PATCH = withAuth(async (request, { params }, user) => {
  await getOwnedFolder(params.id, user.sub);

  const body   = await request.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.flatten().fieldErrors, request);

  const d = parsed.data;
  const sets = []; const vals = []; let i = 1;

  if ('name' in d)     { sets.push(`name = $${i++}`);      vals.push(d.name); }
  if ('parentId' in d) { sets.push(`parent_id = $${i++}`); vals.push(d.parentId); }

  if (!sets.length) return err('No fields to update', request);

  vals.push(params.id);
  const updated = await queryOne(
    `UPDATE folders SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  );
  return ok(updated, request);
});

export const DELETE = withAuth(async (request, { params }, user) => {
  await getOwnedFolder(params.id, user.sub);
  await query(`DELETE FROM folders WHERE id = $1`, [params.id]);
  return noContent(request);
});

export const OPTIONS = (req) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });
