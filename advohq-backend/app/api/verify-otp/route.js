/**
 * POST /api/verify-otp
 * ─────────────────────
 * Verifies the code sent by /api/send-otp. Recomputes the HMAC signature
 * from the token + submitted code and compares it with a constant-time
 * check, so no OTP state needs to live server-side.
 */

import { NextResponse } from 'next/server';
import { base64urlDecode, sign, timingSafeEqual } from '@/lib/otp';
import { createRateLimiter, clientIp } from '@/lib/rateLimit';
import { corsHeaders, handleOptions } from '@/lib/api';

// A 6-digit code has ~1e6 combinations; capping attempts per email+IP keeps
// brute-forcing within a single token's 10-minute lifetime impractical.
const attemptLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 8 });

function jsonErr(message, request, status = 400, extra = {}) {
  return NextResponse.json({ error: message, verified: false, ...extra }, { status, headers: corsHeaders(request) });
}

export async function POST(request) {
  const secret = process.env.OTP_SECRET;
  if (!secret) {
    return jsonErr('Server is not configured: OTP_SECRET is missing.', request, 500);
  }

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const otp = String(body.otp || '').trim();
  const token = String(body.token || '');

  if (!email || !otp || !token.includes('.')) {
    return jsonErr('Missing verification details.', request, 400);
  }

  const limit = attemptLimit(`${clientIp(request)}:${email}`);
  if (!limit.ok) {
    return jsonErr(
      'Too many attempts. Please request a new code and try again shortly.',
      request, 429, { retryAfter: limit.retryAfter }
    );
  }

  const [data, sig] = token.split('.');
  let parsed;
  try {
    parsed = JSON.parse(base64urlDecode(data));
  } catch {
    return jsonErr('Invalid or corrupted code. Please request a new one.', request, 400);
  }

  if (parsed.email !== email) {
    return jsonErr('That code was issued for a different email address.', request, 400);
  }
  if (Date.now() > parsed.expiresAt) {
    return jsonErr('This code has expired. Please request a new one.', request, 400);
  }

  const expectedSig = sign(secret, `${data}.${otp}`);
  if (!timingSafeEqual(expectedSig, sig)) {
    return jsonErr('Incorrect code. Please check and try again.', request, 400);
  }

  return NextResponse.json({ verified: true }, { status: 200, headers: corsHeaders(request) });
}

export const OPTIONS = (req) => handleOptions(req);
