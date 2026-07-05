// In-house provider 1 — cheap, good: quick answers ($0.001).
import { NextRequest, NextResponse } from "next/server";
import { protectRoute } from "@/lib/x402";
import { workTask } from "@/lib/inhouse";

async function handler(req: NextRequest): Promise<NextResponse> {
  const task = await req.json().catch(() => ({}));
  const mode = task?.type === "extract" ? "extract" : "answer";
  const deliverable = await workTask(task, mode);
  return NextResponse.json({ provider: "engye-inhouse-quote", data: deliverable, ...deliverable });
}

export const POST = protectRoute(
  handler,
  0.001,
  "/api/inhouse/quote",
  process.env.PROVIDER1_ADDRESS ?? "",
  "outbound",
);
