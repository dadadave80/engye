"use client";
// Account / profile page — modeled on id.porto.sh's account view (Your account + QR, Assets,
// Permissions, Recovery, Add funds / Help / Sign out), wired to ENGYE's real on-chain data.
import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useDisconnect } from "wagmi";
import { isAddress, encodeFunctionData, decodeAbiParameters, type Address } from "viem";
import { ExternalLink, Copy, Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { Card, Button, Input, Eyebrow } from "./ui/primitives";
import { ConnectButton } from "./wallet/ConnectButton";
import { useWallet } from "./wallet/useWallet";
import { usePasskey } from "./wallet/passkey";
import { useAccountActions } from "./wallet/useAccountActions";
import { ithacaAbi, sessionKeyFor, KeyType, type Call } from "@/lib/ithaca";
import { publicClient, USDC, PROVIDER_STAKE, erc20Abi, providerStakeAbi, ithacaKeysAbi, fromAtomic, ARCSCAN } from "@/lib/clientChain";

const FAUCET = "https://faucet.circle.com/";
const trunc = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const keyTypeLabel = (t: number) => (["P256", "Passkey · WebAuthn", "Wallet · secp256k1", "External · secp256k1"][t] ?? `type ${t}`);

interface KeyRow { expiry: number; keyType: number; isSuperAdmin: boolean; hash: `0x${string}`; publicKey: `0x${string}` }

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
const rowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)" };
const empty: React.CSSProperties = { textAlign: "center", color: "var(--muted-foreground)", fontSize: 13, padding: "20px 0" };

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
          {action}
        </div>
        <button onClick={() => setOpen((o) => !o)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", display: "inline-flex" }}>
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
  const { disconnect } = useDisconnect();
  const { signOut } = usePasskey();
  const { send } = useAccountActions();
  const [usdc, setUsdc] = useState<bigint>(0n);
  const [staked, setStaked] = useState<bigint>(0n);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [copied, setCopied] = useState(false);
  const [newWallet, setNewWallet] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // "add" | `revoke:${hash}`
  const [actErr, setActErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    const [u, s] = await Promise.all([
      publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
      publicClient.readContract({ address: PROVIDER_STAKE, abi: providerStakeAbi, functionName: "stakes", args: [address] }).catch(() => 0n),
    ]);
    setUsdc(u as bigint); setStaked(s as bigint);
    if (isPasskey) {
      try {
        const [ks, hashes] = await publicClient.readContract({ address, abi: ithacaKeysAbi, functionName: "getKeys" });
        setKeys(ks.map((k, i) => ({ expiry: Number(k.expiry), keyType: Number(k.keyType), isSuperAdmin: k.isSuperAdmin, hash: hashes[i], publicKey: k.publicKey })));
      } catch { setKeys([]); }
    }
  }, [address, isPasskey]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch-on-mount; setState runs after await
  useEffect(() => { void load(); }, [load]);

  function copy() {
    if (!address) return;
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }
  function signOff() { wallet.kind === "eoa" ? disconnect() : signOut(); }

  // Recovery: authorize a backup wallet as a super-admin secp256k1 key (passkey signs; ENGYE relays)
  async function addRecovery() {
    const addr = newWallet.trim();
    if (!isAddress(addr)) { setActErr("Enter a valid wallet address (0x…)."); return; }
    if (address && addr.toLowerCase() === address.toLowerCase()) { setActErr("That's this account."); return; }
    setBusy("add"); setActErr(null);
    try {
      const call: Call = { to: address as Address, value: 0n, data: encodeFunctionData({ abi: ithacaAbi, functionName: "authorize", args: [sessionKeyFor(addr)] }) };
      await send([call]);
      setNewWallet("");
      await load();
    } catch (e) { setActErr(e instanceof Error ? e.message.split("\n")[0] : String(e)); }
    finally { setBusy(null); }
  }
  async function revokeKey(hash: `0x${string}`) {
    setBusy(`revoke:${hash}`); setActErr(null);
    try {
      const call: Call = { to: address as Address, value: 0n, data: encodeFunctionData({ abi: ithacaAbi, functionName: "revoke", args: [hash] }) };
      await send([call]);
      await load();
    } catch (e) { setActErr(e instanceof Error ? e.message.split("\n")[0] : String(e)); }
    finally { setBusy(null); }
  }

  if (!wallet.connected || !address) {
    return (
      <Card padding={24}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
          <Eyebrow>Your account</Eyebrow>
          <p style={{ fontSize: 15, maxWidth: 520, lineHeight: 1.5, margin: 0 }}>Connect a passkey or browser wallet to view your account — balances, authorized signers, and recovery.</p>
          <ConnectButton />
        </div>
      </Card>
    );
  }

  const noBalances = usdc === 0n && staked === 0n;
  const signers = keys.filter((k) => k.keyType !== KeyType.Secp256k1); // passkeys
  const recoveryWallets = keys.filter((k) => k.keyType === KeyType.Secp256k1); // backup wallets

  return (
    <Card padding={24}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {/* header actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
          <a href={FAUCET} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Button size="sm">Add funds</Button></a>
          <a href="https://docs.arc.network" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Button size="sm" variant="outline">Help</Button></a>
          <Button size="sm" variant="outline" onClick={signOff} style={{ color: "var(--destructive)", borderColor: "var(--destructive)" }}>Sign out</Button>
        </div>

        {/* Your account + QR */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Eyebrow>Your account</Eyebrow>
            <button onClick={copy} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", color: "var(--foreground)", padding: 0 }}>
              <span style={{ ...mono, fontSize: 15 }}>{trunc(address)}</span>
              {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} color="var(--muted-foreground)" />}
            </button>
            <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{isPasskey ? "Passkey · Ithaca smart account · ENGYE relays gas" : "Injected wallet · self-custodial"}</span>
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
              <div style={rowStyle}><span style={{ color: "var(--muted-foreground)" }}>USDC</span><span style={mono}>{fromAtomic(usdc).toFixed(4)}</span></div>
              {staked > 0n && <div style={rowStyle}><span style={{ color: "var(--muted-foreground)" }}>Staked (co-insurance)</span><span style={mono}>{fromAtomic(staked).toFixed(4)}</span></div>}
            </div>
          )}
        </Section>

        {/* Permissions = authorized signers (the passkey) */}
        <Section title="Permissions">
          {!isPasskey ? <div style={empty}>Self-custodial wallet — full control, no delegated signers.</div>
            : signers.length === 0 ? <div style={empty}>No authorized signers found.</div>
            : signers.map((k) => (
              <div key={k.hash} style={rowStyle}>
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13 }}>{keyTypeLabel(k.keyType)}</span>
                  <span style={{ ...mono, fontSize: 11, color: "var(--muted-foreground)" }}>{trunc(k.hash)}</span>
                </span>
                <span style={{ fontSize: 12, color: k.isSuperAdmin ? "var(--gold-lifted)" : "var(--muted-foreground)" }}>
                  {k.isSuperAdmin ? "super-admin" : "scoped"} · {k.expiry === 0 ? "never expires" : `exp ${new Date(k.expiry * 1000).toLocaleDateString()}`}
                </span>
              </div>
            ))}
        </Section>

        {/* Recovery = backup wallets (secp256k1 super-admin keys) — passkey accounts only */}
        <Section title="Recovery">
          {!isPasskey ? (
            <div style={empty}>Recovery wallets are available for passkey accounts.</div>
          ) : (
            <div>
              {recoveryWallets.length === 0 ? (
                <div style={empty}>No recovery methods added yet.</div>
              ) : recoveryWallets.map((k) => {
                const addr = decodeAbiParameters([{ type: "address" }], k.publicKey)[0] as string;
                return (
                  <div key={k.hash} style={rowStyle}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ ...mono, fontSize: 13 }}>{trunc(addr)}</span>
                      <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>backup wallet · super-admin</span>
                    </span>
                    <button onClick={() => revokeKey(k.hash)} disabled={busy !== null} title="Remove recovery wallet"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", display: "inline-flex" }}>
                      {busy === `revoke:${k.hash}` ? <span style={{ fontSize: 12 }}>removing…</span> : <X size={15} />}
                    </button>
                  </div>
                );
              })}
              {/* Add wallet */}
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 12 }}>
                <div style={{ flex: 1 }}><Input label="Add a backup wallet (0x…)" mono placeholder="0xabc…" value={newWallet} onChange={(e) => setNewWallet(e.target.value)} /></div>
                <Button size="sm" disabled={busy !== null || !newWallet} onClick={addRecovery}>{busy === "add" ? "Signing…" : "Add wallet"}</Button>
              </div>
              <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.5 }}>
                A backup wallet becomes a super-admin signer on this account — it can sign and recover if your passkey is lost. You sign with your passkey; ENGYE relays gas.
              </p>
            </div>
          )}
        </Section>

        {actErr && <div style={{ fontSize: 12.5, color: "var(--oxblood-badge)", marginTop: 8 }}>{actErr}</div>}
      </div>
    </Card>
  );
}
