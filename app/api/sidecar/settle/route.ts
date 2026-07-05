// Creator-settlement sidecar — an x402 provider that computes per-second presence settlements
// DETERMINISTICALLY (this is the count ENGYE bonds; the validator checks arithmetic, not vibes).
// Non-settlement tasks (e.g. the registry's generic probe) fall back to the shared LLM worker.
// Registered via the PUBLIC /api/registry curl (in_house: false) — it exercises the same
// onboarding path as any external provider. Spec: docs/superpowers/specs/2026-07-05-creator-settlement-sidecar-design.md
import { NextRequest, NextResponse } from "next/server";
import { protectRoute } from "@/lib/x402";
import { workTask } from "@/lib/inhouse";
import { computeSettlement, extractSettlementJob } from "@/lib/sidecarSettle";

async function handler(req: NextRequest): Promise<NextResponse> {
  const task = await req.json().catch(() => ({}));
  const job = extractSettlementJob(String(task?.spec ?? ""));
  if (job) {
    return NextResponse.json({ provider: "obol-sidecar-settle", answer: JSON.stringify(computeSettlement(job)) });
  }
  // Fallback (registry probe, non-settlement asks). Money has already settled by the time this
  // handler runs, so NEVER 500 — a weak answer is validated/failed downstream (honest market
  // behavior); a 500 strands the match in "error" after payment.
  try {
    const deliverable = await workTask(task, "answer");
    return NextResponse.json({ provider: "obol-sidecar-settle", ...deliverable });
  } catch (e) {
    console.error("[sidecar/settle] fallback failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json({
      provider: "obol-sidecar-settle",
      answer: "unable to complete this task — no valid settlement event log found in the spec, and the general worker is unavailable",
    });
  }
}

export const POST = protectRoute(
  handler,
  0.01,
  "/api/sidecar/settle",
  process.env.PROVIDER2_ADDRESS ?? "",
  "outbound",
);
