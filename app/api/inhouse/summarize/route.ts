// In-house provider 2 — mid-tier summarizer ($0.003).
import { NextRequest, NextResponse } from "next/server";
import { protectRoute } from "@/lib/x402";
import { workTask } from "@/lib/inhouse";

async function handler(req: NextRequest): Promise<NextResponse> {
  const task = await req.json().catch(() => ({}));
  const deliverable = await workTask(task, "summarize");
  return NextResponse.json({ provider: "engye-inhouse-summarize", ...deliverable });
}

export const POST = protectRoute(
  handler,
  0.003,
  "/api/inhouse/summarize",
  process.env.PROVIDER2_ADDRESS ?? "",
  "outbound",
);
