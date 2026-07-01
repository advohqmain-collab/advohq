/**
 * lib/rateLimit.js
 * ────────────────
 * Best-effort in-memory rate limiter (per server instance — resets on
 * restarts, not shared across instances). No setup required, enough to
 * blunt abuse of a single running instance.
 */

export function createRateLimiter({ windowMs, max }) {
  const hits = new Map(); // key -> [timestamp, ...]

  return function check(key) {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);

    if (recent.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - Math.min(...recent))) / 1000);
      return { ok: false, retryAfter: Math.max(retryAfter, 1) };
    }

    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      }
    }
    return { ok: true };
  };
}

export function clientIp(request) {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}
