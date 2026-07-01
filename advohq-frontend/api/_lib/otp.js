// Shared helpers for stateless email-OTP verification. Serverless functions
// don't share memory across invocations/regions, so the OTP itself is never
// stored server-side — instead it's HMAC-signed into an opaque token that the
// browser holds and sends back on /api/verify-otp. Anyone without OTP_SECRET
// cannot forge a valid signature, so this is as safe as a server-side store
// without needing one.

const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(input) {
  let padded = input.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  return Buffer.from(padded, 'base64').toString('utf8');
}

function sign(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Cryptographically random 6-digit code, zero-padded (000000–999999).
function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

module.exports = { base64url, base64urlDecode, sign, timingSafeEqual, generateOtp };
