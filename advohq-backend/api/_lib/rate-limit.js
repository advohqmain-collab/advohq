// Best-effort in-memory rate limiter (per function instance — resets on cold
// starts, not shared across regions). Same trade-off as the chat endpoint's
// limiter: no setup required, enough to blunt abuse of a single instance.

function createRateLimiter({ windowMs, max }) {
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

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { createRateLimiter, clientIp };
