"use client";
// Flow 3 — anyone can rescue a stuck bond (permissionless claim_timeout). EOA or passkey.
// Handoff .card + .field; connect via the header WalletControl (shown inline when disconnected).
import { useState } from "react";
import { encodeFunctionData } from "viem";
import { WalletControl } from "./wallet/WalletControl";
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
      setInfo(`${STATUS[status] ?? status} · ${fromAtomic(amount).toFixed(3)} USDC · requester ${requester.slice(0, 8)}… · ${status === 1 ? (left > 0 ? `claimable in ${Math.ceil(left / 60)}m` : "claimable now") : "not open"}`);
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
    <div className="card">
      <h3>Rescue a stuck bond</h3>
      <p className="small muted" style={{ maxWidth: "62ch" }}>Past a bond&apos;s deadline, <em>anyone</em> can push its funds to the requester — ENGYE holds no special power here. Paste a match key to inspect and, if expired, rescue it.</p>
      <div className="field">
        <label htmlFor="claim-key">Match key (bytes32)</label>
        <input type="text" id="claim-key" className="input-mono" placeholder="0x…" value={key} onChange={(e) => setKey(e.target.value)} />
      </div>
      <div className="quote-actions">
        <button className="btn btn-ghost btn-sm" onClick={inspect} disabled={!key} aria-disabled={!key}>Inspect</button>
        {wallet.connected
          ? <button className="btn btn-primary btn-sm" onClick={claim} disabled={busy || !key} aria-disabled={busy || !key}>{busy ? "Claiming…" : "Claim for requester"}</button>
          : <WalletControl />}
      </div>
      {info && <p className="mono small" style={{ marginTop: "var(--space-3)", color: "var(--ink)", wordBreak: "break-word" }}>{info}</p>}
      {msg && <p className="small" style={{ marginTop: "var(--space-2)", color: msg.err ? "var(--slash)" : "var(--pass)" }}>{msg.text}{msg.tx && <> · <a href={`${ARCSCAN}/tx/${msg.tx}`} target="_blank" rel="noreferrer">Arcscan ↗</a></>}</p>}
    </div>
  );
}
