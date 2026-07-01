// Vercel Serverless Function — verifies the code sent by /api/send-otp.
// Recomputes the HMAC signature from the token + submitted code and compares
// it with a constant-time check, so no OTP state needs to live server-side.

const { base64urlDecode, sign, timingSafeEqual } = require('./_lib/otp');
const { createRateLimiter, clientIp } = require('./_lib/rate-limit');

// A 6-digit code has ~1e6 combinations; capping attempts per email+IP keeps
// brute-forcing within a single token's 10-minute lifetime impractical.
const attemptLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 8 });

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', verified: false });
  }

  const secret = process.env.OTP_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Server is not configured: OTP_SECRET is missing.', verified: false });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  const otp = String(body.otp || '').trim();
  const token = String(body.token || '');

  if (!email || !otp || !token.includes('.')) {
    return res.status(400).json({ error: 'Missing verification details.', verified: false });
  }

  const limit = attemptLimit(`${clientIp(req)}:${email}`);
  if (!limit.ok) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return res.status(429).json({
      error: 'Too many attempts. Please request a new code and try again shortly.',
      verified: false,
      retryAfter: limit.retryAfter,
    });
  }

  const [data, sig] = token.split('.');
  let parsed;
  try {
    parsed = JSON.parse(base64urlDecode(data));
  } catch {
    return res.status(400).json({ error: 'Invalid or corrupted code. Please request a new one.', verified: false });
  }

  if (parsed.email !== email) {
    return res.status(400).json({ error: 'That code was issued for a different email address.', verified: false });
  }
  if (Date.now() > parsed.expiresAt) {
    return res.status(400).json({ error: 'This code has expired. Please request a new one.', verified: false });
  }

  const expectedSig = sign(secret, `${data}.${otp}`);
  if (!timingSafeEqual(expectedSig, sig)) {
    return res.status(400).json({ error: 'Incorrect code. Please check and try again.', verified: false });
  }

  return res.status(200).json({ verified: true });
};
