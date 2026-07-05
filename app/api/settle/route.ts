// Permissionless settlement poke — anyone may drive overdue matches to completion (spec §3.3).
import { NextRequest, NextResponse } from "next/server";
import { sweepDueMatches, retryTails } from "@/lib/settle";
import { limited } from "@/lib/ratelimit";

export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = limited(req, "settle", 10, 60_000);
  if (rl) return rl;
  const settled = await sweepDueMatches(10);
  const tails = await retryTails(10); // re-post any ERC-8004 tail that failed after settlement (money-free)
  return NextResponse.json({ settled, tails });
}
