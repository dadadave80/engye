"use client";
// Passkey recovery SETUP — register an EOA WALLET OF THE USER'S CHOICE as a recovery key on their
// Circle MSCA. Pick an installed wallet (EIP-6963), read its address (no persistent connection — the
// passkey signs the on-chain registration, the wallet just supplies its address), then
// registerRecovery. If the passkey is ever lost, that wallet signs the restore in ConnectModal.
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useConnectors, type Connector } from "wagmi";
import { X, ShieldCheck, ChevronRight } from "lucide-react";
import { registerRecovery } from "@/lib/circleWallet";
import { ARCSCAN } from "@/lib/clientChain";
import { setRecoveryAddress } from "./recoveryStore";
import type { PasskeySession } from "./passkey";

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 };
const card: React.CSSProperties = { width: 420, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow)", fontFamily: "var(--font-ui)" };
const walletRow: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "12px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--line)", background: "transparent", cursor: "pointer", color: "var(--ink)", fontSize: "var(--text-sm)" };
const trunc = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function RecoveryModal({ session, onClose, onDone }: { session: PasskeySession; onClose: () => void; onDone: (recoveryAddress: string) => void }) {
  const connectors = useConnectors();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ addr: string; tx: string } | null>(null);

  // EIP-6963-announced wallets carry an icon; dedupe by name.
  const wallets = useMemo(() => {
    const seen = new Set<string>();
    return connectors.filter((c) => !!c.icon && !seen.has(c.name) && (seen.add(c.name), true));
  }, [connectors]);
  const hasInjected = typeof window !== "undefined" && "ethereum" in window;
  const fallback = wallets.length === 0 && hasInjected ? connectors.find((c) => c.type === "injected") : undefined;
  const shown = wallets.length ? wallets : fallback ? [fallback] : [];

  async function pick(c: Connector) {
    setBusy(c.uid); setErr(null);
    try {
      const provider = (await c.getProvider()) as { request: (a: { method: string }) => Promise<unknown> };
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const addr = accounts?.[0];
      if (!addr) throw new Error("The wallet returned no account.");
      if (addr.toLowerCase() === session.address.toLowerCase()) throw new Error("That's this passkey account — pick a different wallet.");
      const tx = await registerRecovery(session.credential, addr as `0x${string}`);
      setRecoveryAddress(session.address, addr);
      setDone({ addr, tx });
      onDone(addr);
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally { setBusy(null); }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)", fontWeight: 600 }}>
            <ShieldCheck size={16} color="var(--accent-ink)" /> Register a recovery key
          </span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", display: "inline-flex" }}><X size={16} /></button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {done ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
              <span className="seal seal-pass">RECOVERY ACTIVE</span>
              <p className="small" style={{ margin: 0, lineHeight: 1.5 }}><span className="mono">{trunc(done.addr)}</span> is now a recovery key. If you lose this passkey, choose <b>&ldquo;Recover a lost passkey&rdquo;</b> when connecting and sign with that wallet.</p>
              <a className="tx-link" href={`${ARCSCAN}/tx/${done.tx}`} target="_blank" rel="noreferrer">view on Arcscan ↗</a>
              <button className="btn btn-primary btn-sm" onClick={onClose} style={{ marginTop: 4 }}>Done</button>
            </div>
          ) : (
            <>
              <p className="small muted" style={{ margin: 0, lineHeight: 1.5 }}>
                Choose a wallet you control (e.g. MetaMask). Its address becomes a <b style={{ color: "var(--ink)" }}>recovery key</b> — if you lose this device, that wallet can hand your account to a new passkey. Gas is sponsored.
              </p>
              {shown.length === 0 ? (
                <div className="small muted" style={{ textAlign: "center", lineHeight: 1.6, padding: "8px 0" }}>
                  No wallets detected. Install a browser wallet — e.g. <b>MetaMask</b>, <b>Rabby</b>, or <b>Coinbase Wallet</b> — then reopen this.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {shown.map((c) => (
                    <button key={c.uid} style={walletRow} disabled={busy !== null} onClick={() => pick(c)}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {c.icon ? <img src={c.icon} alt="" width={22} height={22} style={{ borderRadius: 6 }} /> : <span style={{ width: 22, height: 22, borderRadius: 6, background: "var(--bg-raised)" }} />}
                        {c.name}
                      </span>
                      {busy === c.uid ? <span className="small muted">registering…</span> : <ChevronRight size={16} color="var(--muted)" />}
                    </button>
                  ))}
                </div>
              )}
              {err && <p className="small" style={{ margin: 0, color: "var(--slash)" }}>{err}</p>}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
