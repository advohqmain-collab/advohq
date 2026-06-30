/**
 * lib/api.js
 * ──────────
 * Tiny helpers for consistent JSON responses and CORS.
 */

import { NextResponse } from 'next/server';
import { getAuthUser }   from './auth';

// ── CORS ──────────────────────────────────────────────────────────────────────

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',').map(s => s.trim());

export function corsHeaders(request) {
  const origin = request.headers.get('origin') ?? '';
  const allowed = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export function handleOptions(request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

// ── Response helpers ──────────────────────────────────────────────────────────

export function ok(data, request, status = 200) {
  return NextResponse.json({ ok: true, data }, { status, headers: corsHeaders(request) });
}

export function created(data, request) {
  return ok(data, request, 201);
}

export function noContent(request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export function err(message, request, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: corsHeaders(request) });
}

export const unauthorized = (req) => err('Unauthorized', req, 401);
export const forbidden    = (req) => err('Forbidden', req, 403);
export const notFound     = (req) => err('Not found', req, 404);

// ── Auth guard ────────────────────────────────────────────────────────────────

/**
 * Wrap a route handler with auth enforcement.
 * The handler receives (request, context, user) where user is the JWT payload.
 *
 * Usage:
 *   export const GET = withAuth(async (req, ctx, user) => { ... });
 */
export function withAuth(handler, { role } = {}) {
  return async (request, context) => {
    if (request.method === 'OPTIONS') return handleOptions(request);
    try {
      const user = await getAuthUser(request);
      if (!user) return unauthorized(request);
      if (role && user.role !== role && user.role !== 'admin') return forbidden(request);
      return await handler(request, context, user);
    } catch (e) {
      console.error('[withAuth]', e);
      const status = e.status ?? 500;
      return err(e.message || 'Internal server error', request, status);
    }
  };
}

/**
 * Like withAuth but also wraps error handling for public routes.
 */
export function withError(handler) {
  return async (request, context) => {
    if (request.method === 'OPTIONS') return handleOptions(request);
    try {
      return await handler(request, context);
    } catch (e) {
      console.error('[withError]', e);
      const status = e.status ?? 500;
      return err(e.message || 'Internal server error', request, status);
    }
  };
}

// ── Pagination ────────────────────────────────────────────────────────────────

export function parsePagination(url) {
  const { searchParams } = new URL(url);
  const page  = Math.max(1, parseInt(searchParams.get('page')  || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}
