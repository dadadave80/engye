"use client";
// Provider co-insurance staking — user-signed rail-B, EOA OR passkey (via useAccountActions).
// Approve + stake batches into one passkey intent, or two EOA txs. Reads live stake from chain.
// Disconnected → the handoff .gate; connected → .card with live stake + .field amount + .btn actions.
import { useEffect, useState } from "react";
import { encodeFunctionData } from "viem";
import { ConnectGate } from "./ConnectGate";
import { useAccountActions } from "./wallet/useAccountActions";
import {
  publicClient, PROVIDER_STAKE, USDC, erc20Abi, providerStakeAbi, usdcAtomicOrNull, fromAtomic, ARCSCAN,
} from "@/lib/clientChain";
import type { Call } from "@/lib/ithaca";

const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-sm)", padding: "6px 0", borderTop: "1px solid var(--line)" };

export function StakePanel() {
  const { send, wallet } = useAccountActions();
  const address = wallet.address;
  const [staked, setStaked] = useState<bigint>(0n);
  const [pending, setPending] = useState<{ amount: bigint; unlock: bigint }>({ amount: 0n, unlock: 0n });
  const [cooldown, setCooldown] = useState<{ left: number; canWithdraw: boolean }>({ left: 0, canWithdraw: false });
  const [usdcBal, setUsdcBal] = useState<bigint>(0n);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tx?: string; err?: boolean } | null>(null);

  async function refresh() {
    if (!address) return;
    const [s, p, b] = await Promise.all([
      publicClient.readContract({ address: PROVIDER_STAKE, abi: providerStakeAbi, functionName: "stakes", args: [address] }),
      publicClient.readContract({ address: PROVIDER_STAKE, abi: providerStakeAbi, functionName: "pending", args: [address] }),
      publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    ]);
    const [amt, unlock] = p as [bigint, bigint];
    const left = Number(unlock) - Math.floor(Date.now() / 1000);
    setStaked(s as bigint);
    setPending({ amount: amt, unlock });
    setCooldown({ left, canWithdraw: amt > 0n && left <= 0 });
    setUsdcBal(b as bigint);
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch-on-mount; setState runs after await
  useEffect(() => { void refresh(); }, [address]);

  async function run(label: string, calls: Call[]) {
    setBusy(label); setMsg(null);
    try {
      const hash = await send(calls);
      setMsg({ text: `${label} confirmed`, tx: hash });
      await refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message.split("\n")[0] : String(e), err: true });
    } finally { setBusy(null); }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = (to: `0x${string}`, abi: any, fn: string, args: readonly unknown[]): Call =>
    ({ to, value: 0n, data: encodeFunctionData({ abi, functionName: fn, args: args as never }) });

  async function stake() {
    const atomic = usdcAtomicOrNull(Number(amount));
    if (atomic === null) { setMsg({ text: "Enter a valid amount", err: true }); return; }
    await run("Stake", [
      call(USDC, erc20Abi, "approve", [PROVIDER_STAKE, atomic]),
      call(PROVIDER_STAKE, providerStakeAbi, "stake", [atomic]),
    ]);
    setAmount("");
  }

  async function requestUnstake() {
    const atomic = usdcAtomicOrNull(Number(amount));
    if (atomic === null) { setMsg({ text: "Enter a valid amount", err: true }); return; }
    await run("Unstake request", [call(PROVIDER_STAKE, providerStakeAbi, "request_unstake", [atomic])]);
  }

  if (!wallet.connected) {
    return (
      <ConnectGate title="Connect to stake">
        Stakers underwrite the bond pool alongside ENGYE. Slashes draw from the pool; settles feed it.
      </ConnectGate>
    );
  }

  const { left: cooldownLeft, canWithdraw } = cooldown;

  return (
    <div className="card">
      {wallet.kind === "passkey" && <p className="small muted" style={{ marginTop: 0 }}>Passkey account · ENGYE relays gas · signed with your device</p>}
      <div style={{ marginBottom: "var(--space-4)" }}>
        <div style={row}><span className="muted">Your stake</span><span>{fromAtomic(staked).toFixed(3)} USDC</span></div>
        <div style={row}><span className="muted">Account USDC</span><span>{fromAtomic(usdcBal).toFixed(3)} USDC</span></div>
        {pending.amount > 0n && (
          <div style={{ ...row, color: "var(--accent-ink)" }}><span>Unstaking</span><span>{fromAtomic(pending.amount).toFixed(3)} · {canWithdraw ? "ready" : `${Math.ceil(cooldownLeft / 60)}m cooldown`}</span></div>
        )}
      </div>
      {usdcBal < 1_000000n && (
        <p className="small muted">
          Need more USDC? Claim testnet USDC at the <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">Circle Faucet ↗</a> — pick Arc Testnet, paste your address.
        </p>
      )}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="s-amount">Your stake</label>
          <div className="input-suffix">
            <input type="number" id="s-amount" className="input-mono" placeholder="0.050" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="suffix">USDC</span>
          </div>
          <p className="hint">Withdraw any time no bonds are open against the pool.</p>
        </div>
        <div className="field" style={{ alignSelf: "end" }}>
          <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy !== null || !amount} aria-disabled={busy !== null || !amount} onClick={stake}>
            {busy === "Stake" ? "Staking…" : "Stake"}
          </button>
        </div>
      </div>
      <div className="quote-actions">
        <button className="btn btn-ghost btn-sm" disabled={busy !== null || staked === 0n || !amount} aria-disabled={busy !== null || staked === 0n || !amount} onClick={requestUnstake}>Request unstake</button>
        <button className="btn btn-ghost btn-sm" disabled={busy !== null || !canWithdraw} aria-disabled={busy !== null || !canWithdraw} onClick={() => run("Withdraw", [call(PROVIDER_STAKE, providerStakeAbi, "withdraw", [])])}>Withdraw</button>
      </div>
      {msg && (
        <p className="small" style={{ marginTop: "var(--space-3)", color: msg.err ? "var(--slash)" : "var(--pass)" }}>
          {msg.text}{msg.tx && <> · <a href={`${ARCSCAN}/tx/${msg.tx}`} target="_blank" rel="noreferrer">Arcscan ↗</a></>}
        </p>
      )}
    </div>
  );
}
