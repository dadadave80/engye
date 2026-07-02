// Provision a passkey-controlled Ithaca account (mint+delegate throwaway EOA, authorize passkey).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { provisionPasskeyAccount } from "@/lib/passkeyAccount";
import { limited } from "@/lib/ratelimit";

export const maxDuration = 60;

const schema = z.object({
  credentialId: z.string().min(8).max(512),
  key: z.object({
    expiry: z.number().int().nonnegative(),
    keyType: z.number().int().min(0).max(3),
    isSuperAdmin: z.boolean(),
    publicKey: z.string().regex(/^0x[0-9a-fA-F]+$/),
  }),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = limited(req, "passkey-provision", 5, 3_600_000); // each provisions 2 sponsored txs
  if (rl) return rl;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });
  try {
    const account = await provisionPasskeyAccount({ ...parsed.data.key, publicKey: parsed.data.key.publicKey as `0x${string}` }, parsed.data.credentialId);
    return NextResponse.json({ account });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.error("[passkey/provision]", raw);
    // transport hiccups (viem HttpRequestError / timeouts) are transient — tell the user to retry
    const transient = /HTTP request failed|timed out|took too long|fetch failed|ECONN|socket/i.test(raw);
    const message = transient ? "Couldn't reach Arc just now — please try again in a moment." : raw;
    return NextResponse.json({ error: "provision failed", message }, { status: 500 });
  }
}
