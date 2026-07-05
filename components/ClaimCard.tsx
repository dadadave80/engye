"use client";
// Flow 3 — anyone can rescue a stuck bond (permissionless claim_timeout). EOA or passkey.
import { useState } from "react";
import { encodeFunctionData } from "viem";
import { Card, Button, Input, Eyebrow } from "./ui/primitives";
import { ConnectButton } from "./wallet/ConnectButton";
import { useAccountActions } from "./wallet/useAccountActions";
import { publicClient, ESCROW, escrowAbi, fromAtomic, ARCSCAN } from "@/lib/clientChain";

const STATUS = ["", "OPEN", "RELEASED", "SLASHED", "TIMEOUT_CLAIMED"];

export function ClaimCard() {
  const { send, wallet } = useAccountActions();
  const [key, setKey] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tx?: string; err?: boolean } | null>(null);

  async function inspect() {
    setMsg(null); setInfo(null);
    try {
      const b = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: "bonds", args: [key as `0x${string}`] });
      const [, requester, amount, status, , deadline] = b as [string, string, bigint, number, string, bigint];
      const left = Number(deadline) - Math.floor(Date.now() / 1000);
      setInfo(`${STATUS[status] ?? status} · ${fromAtomic(amount).toFixed(4)} USDC · requester ${requester.slice(0, 8)}… · ${status === 1 ? (left > 0 ? `claimable in ${Math.ceil(left / 60)}m` : "claimable now") : "not open"}`);
    } catch (e) { setMsg({ text: e instanceof Error ? e.message.split("\n")[0] : String(e), err: true }); }
  }

  async function claim() {
    setBusy(true); setMsg(null);
    try {
      const hash = await send([{ to: ESCROW, value: 0n, data: encodeFunctionData({ abi: escrowAbi, functionName: "claim_timeout", args: [key as `0x${string}`] }) }]);
      setMsg({ text: "Rescued — bond sent to the requester", tx: hash });
    } catch (e) { setMsg({ text: e instanceof Error ? e.message.split("\n")[0] : String(e), err: true }); }
    finally { setBusy(false); }
  }

  return (
    <Card padding={24}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Eyebrow>Trustless rescue</Eyebrow>
        <p style={{ fontSize: 13, color: "var(--muted-foreground)", margin: 0, maxWidth: 560, lineHeight: 1.5 }}>Past a bond&apos;s deadline, <em>anyone</em> can push its funds to the requester — ENGYE holds no special power here. Paste a match key to inspect and, if expired, rescue it.</p>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="min-w-0" style={{ flex: 1, minWidth: 200 }}><Input label="Match key (bytes32)" mono placeholder="0x…" value={key} onChange={(e) => setKey(e.target.value)} /></div>
          <Button variant="outline" size="sm" onClick={inspect} disabled={!key}>Inspect</Button>
          {wallet.connected
            ? <Button size="sm" onClick={claim} disabled={busy || !key}>{busy ? "Claiming…" : "Claim for Requester"}</Button>
            : <ConnectButton />}
        </div>
        {info && <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--foreground)", wordBreak: "break-word" }}>{info}</div>}
        {msg && <div style={{ fontSize: 13, color: msg.err ? "var(--oxblood-badge)" : "var(--success)" }}>{msg.text}{msg.tx && <> · <a href={`${ARCSCAN}/tx/${msg.tx}`} target="_blank" rel="noreferrer" style={{ color: "var(--link)" }}>Arcscan</a></>}</div>}
      </div>
    </Card>
  );
}
