import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "./ratelimit-core";

export { rateLimit };

export function clientIp(req: NextRequest): string {
  // x-real-ip is set by the Vercel edge to the true client IP (single value, not client-appendable);
  // prefer it over the client-prependable leftmost x-forwarded-for token.
  return req.headers.get("x-real-ip")?.trim() ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** Returns a 429 response if over-limit, else null. */
export function limited(req: NextRequest, bucket: string, max: number, windowMs: number): NextResponse | null {
  if (rateLimit(`${bucket}:${clientIp(req)}`, max, windowMs)) return null;
  return NextResponse.json(
    { error: "rate limited", detail: `Too many ${bucket} requests. Try again shortly.` },
    { status: 429, headers: { "Retry-After": String(Math.ceil(windowMs / 1000)) } },
  );
}
