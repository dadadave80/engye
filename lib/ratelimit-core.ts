// Lightweight in-memory sliding-window rate limiter.
// ponytail: per-instance memory only — on Vercel Fluid Compute instances are reused so this
// holds for bursts from one IP, but is NOT globally exact across instances. Upgrade to Upstash
// Ratelimit if abuse crosses instances; for a testnet hackathon the price cap + this suffice.

const hits = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  // opportunistic GC so the map can't grow unbounded
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  return true;
}
