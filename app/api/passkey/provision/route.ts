// Register a Circle-MSCA passkey account (execute's payer allow-list) + one-time USDC sponsor.
// The client derives the MSCA address from the passkey; Circle deploys it lazily on first userOp.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { registerPasskeyAccount } from "@/lib/passkeyAccount";
import { deriveMscaAddress } from "@/lib/circleWalletServer";
import { limited } from "@/lib/ratelimit";
import type { Hex } from "viem";

export const maxDuration = 60;

const schema = z.object({
  credentialId: z.string().min(8).max(512),
  account: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  publicKey: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = limited(req, "passkey-provision", 5, 3_600_000); // each sponsors a little USDC
  if (rl) return rl;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad request" }, { status: 400 });

  // ANTI FUND-DRAIN: never trust the client-supplied `account`. Derive the MSCA server-side from the
  // credential's public key and require the claim to match — the USDC sponsor can then only ever
  // reach the real account of the supplied passkey, never an attacker-chosen address. Fail CLOSED:
  // if we can't derive (Circle unconfigured / RPC blip) we refuse rather than sponsor an unverified
  // address. (Residual: an attacker could still farm sponsors with their own P256 keypairs, bounded
  // by the 5/hr/IP limit + testnet 0.25 USDC — inherent faucet risk, accepted.)
  let derived;
  try {
    derived = await deriveMscaAddress(parsed.data.credentialId, parsed.data.publicKey as Hex);
  } catch (e) {
    console.error("[passkey/provision] derive failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "registration unavailable", message: "Couldn't verify the passkey account right now — please try again." }, { status: 503 });
  }
  if (derived.toLowerCase() !== parsed.data.account.toLowerCase()) {
    return NextResponse.json({ error: "account does not match the passkey credential" }, { status: 422 });
  }

  try {
    const account = await registerPasskeyAccount({
      credentialId: parsed.data.credentialId,
      account: derived, // server-derived, verified
      publicKey: parsed.data.publicKey as Hex,
    });
    return NextResponse.json({ account });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.error("[passkey/provision]", raw);
    const transient = /HTTP request failed|timed out|took too long|fetch failed|ECONN|socket/i.test(raw);
    const message = transient ? "Couldn't reach Arc just now — please try again in a moment." : raw;
    return NextResponse.json({ error: "register failed", message }, { status: 500 });
  }
}
