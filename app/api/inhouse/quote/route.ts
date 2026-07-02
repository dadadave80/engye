// In-house provider 1 — cheap, good. Phase 1: static deliverable proving the rail;
// Phase 4 swaps in the real LLM worker.
import { NextRequest, NextResponse } from "next/server";
import { protectRoute } from "@/lib/x402";

const PRICE_USDC = 0.001;

async function handler(req: NextRequest): Promise<NextResponse> {
  const task = await req.json().catch(() => ({}));
  return NextResponse.json({
    provider: "engye-inhouse-quote",
    deliverable: {
      summary: "Phase 1 rail spike: paid deliverable served.",
      echo: task,
      served_at: new Date().toISOString(),
    },
  });
}

export const POST = protectRoute(
  handler,
  PRICE_USDC,
  "/api/inhouse/quote",
  process.env.PROVIDER1_ADDRESS ?? "",
  "outbound",
);
