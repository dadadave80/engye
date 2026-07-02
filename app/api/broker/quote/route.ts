// Free endpoint: LLM decision #1 → priced, bonded quote (or a decline with reasons).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { quoteTask } from "@/lib/broker";

const bodySchema = z.object({
  task: z.object({
    type: z.string().min(1),
    spec: z.string().min(1).max(8000),
    max_price_usdc: z.number().positive().max(10),
    quality_bar: z.string().max(1000).optional(),
  }),
  requester_wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  }
  try {
    const quote = await quoteTask(parsed.data.task, parsed.data.requester_wallet ?? null);
    return NextResponse.json(quote);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[quote] error:", message);
    return NextResponse.json({ error: "quote failed", message }, { status: 500 });
  }
}
