"use client";
// TEMP verification harness (removed after): proves the Circle money-path infra headlessly — MSCA
// creation → provision (register + 0.25 USDC sponsor) → a FUNDED gasless userOp (Gas Station
// paymaster) transferring USDC → mined receipt. Uses a LOCAL owner key (toCircleSmartAccount accepts
// LocalAccount | WebAuthnAccount) so no biometric is needed; the WebAuthn signing half is already
// device-confirmed. Runs in-browser on the allowlisted origin (the Client Key is domain-bound).
import { useState } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, encodeFunctionData, erc20Abi, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { createBundlerClient } from "viem/account-abstraction";
import { toCircleSmartAccount, toModularTransport } from "@circle-fin/modular-wallets-core";
import { USDC } from "@/lib/clientChain";

export default function PayTest() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const add = (s: string) => setLog((l) => [...l, s]);

  async function run() {
    setBusy(true); setLog([]);
    try {
      const CK = process.env.NEXT_PUBLIC_CLIENT_KEY, CU = process.env.NEXT_PUBLIC_CLIENT_URL;
      if (!CK || !CU) { add("x Circle not configured"); return; }
      const modular = toModularTransport(`${CU}/arcTestnet`, CK);
      const client = createPublicClient({ chain: arcTestnet, transport: modular });
      const bundler = createBundlerClient({ chain: arcTestnet, transport: modular });

      const owner = privateKeyToAccount(generatePrivateKey());
      add("owner: " + owner.address);
      const account = await toCircleSmartAccount({ client, owner });
      add("MSCA: " + account.address);

      add("-> provision (register + 0.25 USDC sponsor)...");
      const pr = await fetch("/api/passkey/provision", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentialId: "paytest-" + account.address, account: account.address, publicKey: "0x" + "ab".repeat(64) }),
      });
      add("provision: " + pr.status + " " + JSON.stringify(await pr.json()));

      add("-> FUNDED gasless userOp: transfer 0.01 USDC, paymaster:true...");
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [owner.address, 10_000n] });
      const uo = await bundler.sendUserOperation({ account, calls: [{ to: USDC, value: 0n, data }], paymaster: true });
      add("userOp: " + uo);
      const { receipt } = await bundler.waitForUserOperationReceipt({ hash: uo as Hex });
      add(`RESULT tx=${receipt.transactionHash} status=${receipt.status}`);
    } catch (e) {
      add("x " + (e instanceof Error ? e.message.split("\n")[0] : String(e)));
    } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace", maxWidth: 820 }}>
      <button id="run" onClick={run} disabled={busy} style={{ padding: "10px 16px", fontSize: 14, cursor: "pointer" }}>
        {busy ? "running..." : "Run gasless userOp test"}
      </button>
      <pre id="out" style={{ marginTop: 16, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{log.join("\n")}</pre>
    </div>
  );
}
