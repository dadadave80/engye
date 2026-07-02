"use client";
// Provider co-insurance staking — user-signed rail-B, EOA OR passkey (via useAccountActions).
// Approve + stake batches into one passkey intent, or two EOA txs. Reads live stake from chain.
import { useEffect, useState } from "react";
import { encodeFunctionData } from "viem";
import { Card, Button, Input, Eyebrow } from "./ui/primitives";
import { ConnectButton } from "./wallet/ConnectButton";
import { useAccountActions } from "./wallet/useAccountActions";
import {
  publicClient, PROVIDER_STAKE, USDC, erc20Abi, providerStakeAbi, usdcAtomic, fromAtomic, ARCSCAN,
} from "@/lib/clientChain";
import type { Call } from "@/lib/ithaca";

const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: 14, padding: "6px 0" };

export function StakePanel() {
  const { send, wallet } = useAccountActions();
  const address = wallet.address;
  const [staked, setStaked] = useState<bigint>(0n);
  const [pending, setPending] = useState<{ amount: bigint; unlock: bigint }>({ amount: 0n, unlock: 0n });
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
    setStaked(s as bigint);
    setPending({ amount: (p as [bigint, bigint])[0], unlock: (p as [bigint, bigint])[1] });
    setUsdcBal(b as bigint);
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [address]);

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
    const atomic = usdcAtomic(Number(amount));
    if (atomic <= 0n) return;
    // approve + stake — one batched passkey intent, or two sequential EOA txs
    await run("Stake", [
      call(USDC, erc20Abi, "approve", [PROVIDER_STAKE, atomic]),
      call(PROVIDER_STAKE, providerStakeAbi, "stake", [atomic]),
    ]);
    setAmount("");
  }

  if (!wallet.connected) {
    return (
      <Card padding={24}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
          <Eyebrow>Skin in the game</Eyebrow>
          <p style={{ fontSize: 15, maxWidth: 520, lineHeight: 1.5, margin: 0 }}>Stake USDC as co-insurance behind your endpoint. On a failed match, your stake is slashed to the requester on top of ENGYE&apos;s bond — so staking is a public signal of confidence, and the broker weighs it when routing.</p>
          <ConnectButton />
        </div>
      </Card>
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const cooldownLeft = Number(pending.unlock) - now;
  const canWithdraw = pending.amount > 0n && cooldownLeft <= 0;

  return (
    <Card padding={24}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {wallet.kind === "passkey" && <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Passkey account · ENGYE relays gas · signed with your device</div>}
        <div style={row}><span style={{ color: "var(--muted-foreground)" }}>Your stake</span><span>{fromAtomic(staked).toFixed(4)} USDC</span></div>
        <div style={row}><span style={{ color: "var(--muted-foreground)" }}>Account USDC</span><span>{fromAtomic(usdcBal).toFixed(4)} USDC</span></div>
        {pending.amount > 0n && (
          <div style={{ ...row, color: "var(--gold-lifted)" }}><span>Unstaking</span><span>{fromAtomic(pending.amount).toFixed(4)} · {canWithdraw ? "ready" : `${Math.ceil(cooldownLeft / 60)}m cooldown`}</span></div>
        )}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}><Input label="Amount (USDC)" mono placeholder="1.0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <Button disabled={busy !== null || !amount} onClick={stake}>{busy === "Stake" ? "Staking…" : "Stake"}</Button>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Button variant="outline" size="sm" disabled={busy !== null || staked === 0n || !amount}
            onClick={() => run("Unstake request", [call(PROVIDER_STAKE, providerStakeAbi, "request_unstake", [usdcAtomic(Number(amount))])])}>
            Request unstake
          </Button>
          <Button variant="outline" size="sm" disabled={busy !== null || !canWithdraw}
            onClick={() => run("Withdraw", [call(PROVIDER_STAKE, providerStakeAbi, "withdraw", [])])}>
            Withdraw
          </Button>
        </div>
        {msg && (
          <div style={{ fontSize: 13, color: msg.err ? "var(--oxblood-badge)" : "var(--success)" }}>
            {msg.text}{msg.tx && <> · <a href={`${ARCSCAN}/tx/${msg.tx}`} target="_blank" rel="noreferrer" style={{ color: "var(--link)" }}>Arcscan</a></>}
          </div>
        )}
      </div>
    </Card>
  );
}
