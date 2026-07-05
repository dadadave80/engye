import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "./ratelimit-core";

export { rateLimit };

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
}

/** Returns a 429 response if over-limit, else null. */
export function limited(req: NextRequest, bucket: string, max: number, windowMs: number): NextResponse | null {
  if (rateLimit(`${bucket}:${clientIp(req)}`, max, windowMs)) return null;
  return NextResponse.json(
    { error: "rate limited", detail: `Too many ${bucket} requests. Try again shortly.` },
    { status: 429, headers: { "Retry-After": String(Math.ceil(windowMs / 1000)) } },
  );
}
