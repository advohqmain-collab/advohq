// Vercel Serverless Function — sends a 6-digit email verification code for
// the signup flow (signup.html). Stateless: the OTP is HMAC-signed into an
// opaque token returned to the browser instead of stored server-side (see
// api/_lib/otp.js). The browser sends the token + code back to
// /api/verify-otp to complete verification.

const { base64url, sign, generateOtp } = require('./_lib/otp');
const { createRateLimiter, clientIp } = require('./_lib/rate-limit');

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const perEmailLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });  // 5 sends/hour/email
const perIpLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 20 });    // 20 sends/hour/IP

async function sendEmail(to, otp) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // No email provider configured — log instead of sending so local/dev
    // testing works out of the box (see send-otp response's devOtp field).
    console.log(`[send-otp] dev mode (no RESEND_API_KEY) — code for ${to}: ${otp}`);
    return { sent: false };
  }

  const from = process.env.RESEND_FROM || 'AdvoHQ <onboarding@resend.dev>';
  const upstream = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from,
      to,
      subject: 'Your AdvoHQ verification code',
      text: `Your AdvoHQ verification code is ${otp}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    throw new Error(`Resend API error ${upstream.status}: ${detail}`);
  }
  return { sent: true };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.OTP_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Server is not configured: OTP_SECRET is missing.' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  if (!emailRe.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  const ipCheck = perIpLimit(clientIp(req));
  const emailCheck = perEmailLimit(email);
  const limitHit = !ipCheck.ok ? ipCheck : !emailCheck.ok ? emailCheck : null;
  if (limitHit) {
    res.setHeader('Retry-After', String(limitHit.retryAfter));
    return res.status(429).json({
      error: 'Too many code requests. Please wait a little while and try again.',
      retryAfter: limitHit.retryAfter,
    });
  }

  const otp = generateOtp();
  const expiresAt = Date.now() + OTP_TTL_MS;
  const data = base64url(JSON.stringify({ email, expiresAt }));
  const token = `${data}.${sign(secret, `${data}.${otp}`)}`;

  try {
    const { sent } = await sendEmail(email, otp);
    const payload = { token, expiresAt };
    // Only surface the raw code when no real email provider is configured —
    // otherwise there'd be no way to test this locally without Resend set up.
    if (!sent) payload.devOtp = otp;
    return res.status(200).json(payload);
  } catch (err) {
    console.error('send-otp: email delivery failed', err);
    return res.status(502).json({ error: 'Could not send the verification email. Please try again.' });
  }
};
