"use client";
// Account / profile page — the connected passkey (Circle MSCA): address + QR, Assets, and passkey
// Recovery (register a BIP-39 phrase so a lost device never locks the account). Wired to real
// on-chain balances; recovery uses Circle Modular Wallets' recoveryActions (see lib/circleWallet).
import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ExternalLink, Copy, Check, ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";
import { Card, Button, Eyebrow } from "./ui/primitives";
import { ConnectGate } from "./ConnectGate";
import { RecoveryModal } from "./wallet/RecoveryModal";
import { getRecoveryAddress } from "./wallet/recoveryStore";
import { useWallet } from "./wallet/useWallet";
import { usePasskey } from "./wallet/passkey";
import { publicClient, USDC, PROVIDER_STAKE, erc20Abi, providerStakeAbi, fromAtomic, ARCSCAN } from "@/lib/clientChain";

const FAUCET = "https://faucet.circle.com/";
const trunc = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const rowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" };
const empty: React.CSSProperties = { textAlign: "center", color: "var(--muted-foreground)", fontSize: 13, padding: "20px 0" };

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
          {action}
        </div>
        <button onClick={() => setOpen((o) => !o)} aria-label={open ? "Collapse" : "Expand"} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", display: "inline-flex" }}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>
      {open && children}
    </div>
  );
}

export function AccountPanel() {
  const wallet = useWallet();
  const address = wallet.address;
  const isPasskey = wallet.kind === "passkey";
  const { current, signOut } = usePasskey();
  const [usdc, setUsdc] = useState<bigint>(0n);
  const [staked, setStaked] = useState<bigint>(0n);
  const [copied, setCopied] = useState(false);
  const [recoveryAddr, setRecoveryAddr] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);

  const load = useCallback(async () => {
    if (!address) return;
    try {
      const [u, s] = await Promise.all([
        publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
        publicClient.readContract({ address: PROVIDER_STAKE, abi: providerStakeAbi, functionName: "stakes", args: [address] }).catch(() => 0n),
      ]);
      setUsdc(u as bigint); setStaked(s as bigint);
    } catch { /* transient read failure — keep last known balances */ }
  }, [address]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch-on-mount; setState runs after await
  useEffect(() => { void load(); }, [load]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage read (client only)
  useEffect(() => { if (address) setRecoveryAddr(getRecoveryAddress(address)); }, [address]);

  function copy() {
    if (!address) return;
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  if (!wallet.connected || !address) {
    return (
      <ConnectGate title="Connect to view your ledger">
        Your balances and recovery live on Arc; this page is just a window onto them.
      </ConnectGate>
    );
  }

  const noBalances = usdc === 0n && staked === 0n;

  return (
    <Card padding={24}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {/* header actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <a href={FAUCET} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Button size="sm">Add Funds</Button></a>
          <a href="https://docs.arc.network" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Button size="sm" variant="outline">Help</Button></a>
          <Button size="sm" variant="outline" onClick={signOut}>Sign Out</Button>
        </div>

        {/* Your account + QR */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div className="min-w-0" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Eyebrow>Your account</Eyebrow>
            <button onClick={copy} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", color: "var(--foreground)", padding: 0 }}>
              <span style={{ ...mono, fontSize: 15 }}>{trunc(address)}</span>
              {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} color="var(--muted-foreground)" />}
            </button>
            <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{isPasskey ? "Passkey · Circle smart account · ENGYE relays gas" : "Wallet"}</span>
            <a href={`${ARCSCAN}/address/${address}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--link)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
              View on Arcscan <ExternalLink size={11} />
            </a>
          </div>
          <div style={{ background: "#fff", padding: 8, borderRadius: 8, lineHeight: 0 }}>
            <QRCodeSVG value={address} size={92} bgColor="#ffffff" fgColor="#191511" level="M" />
          </div>
        </div>

        {/* Assets */}
        <Section title="Assets">
          {noBalances ? <div style={empty}>No balances available for this account.</div> : (
            <div>
              <div style={rowStyle}><span style={{ color: "var(--muted-foreground)" }}>USDC</span><span style={mono}>{fromAtomic(usdc).toFixed(3)}</span></div>
              {staked > 0n && <div style={rowStyle}><span style={{ color: "var(--muted-foreground)" }}>Staked (co-insurance)</span><span style={mono}>{fromAtomic(staked).toFixed(3)}</span></div>}
            </div>
          )}
          {usdc < 1_000000n && (
            <a href={FAUCET} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted-foreground)", textDecoration: "none", marginTop: 10 }}>
              Need more? Claim testnet USDC at the <span style={{ color: "var(--link)" }}>Circle Faucet</span> <ExternalLink size={11} /> <span>(pick Arc Testnet)</span>
            </a>
          )}
        </Section>

        {/* Recovery — register a BIP-39 phrase so a lost passkey never locks the account */}
        <Section title="Recovery" action={
          isPasskey && current
            ? <Button size="sm" variant="outline" onClick={() => setShowRecovery(true)}>{recoveryAddr ? "Change recovery key" : "Register a recovery key"}</Button>
            : undefined
        }>
          {!isPasskey ? (
            <div style={empty}>Recovery is available for passkey accounts.</div>
          ) : recoveryAddr ? (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0" }}>
              <ShieldCheck size={18} color="var(--success)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 13, lineHeight: 1.5 }}>
                <b>Recovery is active.</b> Wallet <span style={mono}>{trunc(recoveryAddr)}</span> is registered as a recovery key — if you lose this device, choose <b>&ldquo;Recover a lost passkey&rdquo;</b> when connecting and sign with that wallet.
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0" }}>
              <ShieldCheck size={18} color="var(--muted-foreground)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--muted-foreground)" }}>
                No recovery yet. This account lives only on this device&apos;s passkey — register a wallet you control as a recovery key so a lost or wiped device doesn&apos;t lock you out for good.
              </span>
            </div>
          )}
        </Section>
      </div>

      {showRecovery && current && (
        <RecoveryModal session={current} onClose={() => setShowRecovery(false)} onDone={(addr) => setRecoveryAddr(addr)} />
      )}
    </Card>
  );
}
