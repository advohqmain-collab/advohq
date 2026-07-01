/**
 * POST /api/send-otp
 * ───────────────────
 * Sends a 6-digit email verification code for the signup flow (signup.html).
 * Stateless: the OTP is HMAC-signed into an opaque token returned to the
 * browser instead of stored server-side (see lib/otp.js). The browser sends
 * the token + code back to /api/verify-otp to complete verification.
 */

import { NextResponse } from 'next/server';
import { base64url, sign, generateOtp } from '@/lib/otp';
import { createRateLimiter, clientIp } from '@/lib/rateLimit';
import { corsHeaders, handleOptions } from '@/lib/api';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const perEmailLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });  // 5 sends/hour/email
const perIpLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 20 });    // 20 sends/hour/IP

function jsonErr(message, request, status = 400, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status, headers: corsHeaders(request) });
}

async function sendEmail(to, otp) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    // No email provider configured — log instead of sending so local/dev
    // testing works out of the box (see send-otp response's devOtp field).
    console.log(`[send-otp] dev mode (no BREVO_API_KEY) — code for ${to}: ${otp}`);
    return { sent: false };
  }

  const fromEmail = process.env.BREVO_FROM_EMAIL || 'no-reply@advohq.in';
  const fromName  = process.env.BREVO_FROM_NAME  || 'AdvoHQ';
  const upstream = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: to }],
      subject: 'Your AdvoHQ verification code',
      textContent: `Your AdvoHQ verification code is ${otp}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    throw new Error(`Brevo API error ${upstream.status}: ${detail}`);
  }
  return { sent: true };
}

export async function POST(request) {
  const secret = process.env.OTP_SECRET;
  if (!secret) {
    return jsonErr('Server is not configured: OTP_SECRET is missing.', request, 500);
  }

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  if (!emailRe.test(email)) {
    return jsonErr('Enter a valid email address.', request, 400);
  }

  const ipCheck = perIpLimit(clientIp(request));
  const emailCheck = perEmailLimit(email);
  const limitHit = !ipCheck.ok ? ipCheck : !emailCheck.ok ? emailCheck : null;
  if (limitHit) {
    return jsonErr(
      'Too many code requests. Please wait a little while and try again.',
      request, 429, { retryAfter: limitHit.retryAfter }
    );
  }

  const otp = generateOtp();
  const expiresAt = Date.now() + OTP_TTL_MS;
  const data = base64url(JSON.stringify({ email, expiresAt }));
  const token = `${data}.${sign(secret, `${data}.${otp}`)}`;

  try {
    const { sent } = await sendEmail(email, otp);
    const payload = { token, expiresAt };
    // Only surface the raw code when no real email provider is configured —
    // otherwise there'd be no way to test this locally without Brevo set up.
    if (!sent) payload.devOtp = otp;
    return NextResponse.json(payload, { status: 200, headers: corsHeaders(request) });
  } catch (err) {
    console.error('send-otp: email delivery failed', err);
    return jsonErr('Could not send the verification email. Please try again.', request, 502);
  }
}

export const OPTIONS = (req) => handleOptions(req);
