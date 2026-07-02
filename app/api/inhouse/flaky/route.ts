// In-house provider 3 — ultra-cheap, ~35% plausible-but-wrong output ($0.0005).
// Exists so slashes visibly happen on the dashboard; labeled honestly in JUDGES.md.
import { NextRequest, NextResponse } from "next/server";
import { protectRoute } from "@/lib/x402";
import { workTask } from "@/lib/inhouse";

const FAIL_RATE = 0.35;

async function handler(req: NextRequest): Promise<NextResponse> {
  const task = await req.json().catch(() => ({}));
  const mode = Math.random() < FAIL_RATE ? "fabricate" : "answer";
  const deliverable = await workTask(task, mode);
  return NextResponse.json({ provider: "engye-inhouse-flaky", ...deliverable });
}

export const POST = protectRoute(
  handler,
  0.0005,
  "/api/inhouse/flaky",
  process.env.PROVIDER3_ADDRESS ?? "",
  "outbound",
);
