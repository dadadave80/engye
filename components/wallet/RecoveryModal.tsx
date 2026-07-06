"use client";
// Passkey recovery SETUP (Circle Modular Wallets). Generates a BIP-39 phrase in the browser, shows
// it ONCE (never sent anywhere), and — after the user confirms they saved it — registers the phrase's
// EOA as a recovery owner on their MSCA (gasless). If the passkey is ever lost, that phrase restores
// the account via ConnectModal's "recover" flow. The mnemonic never leaves the client.
import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Copy, Check, ShieldCheck } from "lucide-react";
import { generateRecovery, registerRecovery } from "@/lib/circleWallet";
import { ARCSCAN } from "@/lib/clientChain";
import { markRecoverySet } from "./recoveryStore";
import type { PasskeySession } from "./passkey";

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 };
const card: React.CSSProperties = { width: 440, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow)", fontFamily: "var(--font-ui)" };
const mono: React.CSSProperties = { fontFamily: "var(--font-mono)" };

export function RecoveryModal({ session, onClose, onDone }: { session: PasskeySession; onClose: () => void; onDone: () => void }) {
  // generate the phrase once, synchronously, on first (client-only) render — the modal never SSRs
  const [gen] = useState<{ mnemonic: string; recoveryAddress: `0x${string}` } | null>(() => {
    try { return generateRecovery(); } catch { return null; }
  });
  const phrase = gen?.mnemonic ?? null;
  const recoveryAddress = gen?.recoveryAddress ?? null;
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(gen ? null : "Couldn't generate a recovery phrase in this browser.");
  const [tx, setTx] = useState<string | null>(null);

  const words = phrase ? phrase.split(" ") : [];

  async function copy() {
    if (!phrase) return;
    try { await navigator.clipboard.writeText(phrase); } catch { /* clipboard blocked — user can select manually */ }
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  }

  async function activate() {
    if (!recoveryAddress) return;
    setBusy(true); setErr(null);
    try {
      const hash = await registerRecovery(session.credential, recoveryAddress);
      markRecoverySet(session.address);
      setTx(hash);
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message.split("\n")[0] : String(e)); }
    finally { setBusy(false); }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)", fontWeight: 600 }}>
            <ShieldCheck size={16} color="var(--accent-ink)" /> Set up passkey recovery
          </span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", display: "inline-flex" }}><X size={16} /></button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {tx ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
              <span className="seal seal-pass">RECOVERY ACTIVE</span>
              <p className="small" style={{ margin: 0, lineHeight: 1.5 }}>Your recovery phrase is registered on-chain. If you lose this passkey, choose <b>&ldquo;Recover a lost passkey&rdquo;</b> on the connect screen and enter the phrase.</p>
              <a className="tx-link" href={`${ARCSCAN}/tx/${tx}`} target="_blank" rel="noreferrer">view on Arcscan ↗</a>
              <button className="btn btn-primary btn-sm" onClick={onClose} style={{ marginTop: 4 }}>Done</button>
            </div>
          ) : (
            <>
              <p className="small muted" style={{ margin: 0, lineHeight: 1.5 }}>
                Write these {words.length} words down in order and keep them somewhere safe and offline. <b style={{ color: "var(--ink)" }}>This is the only way to recover your account</b> if you lose this device — anyone with the phrase can take it.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, background: "var(--bg-raised)", border: "1px solid var(--line)", borderRadius: "var(--radius-md)", padding: 12 }}>
                {words.length === 0 && !err && <span className="small muted" style={{ gridColumn: "1 / -1", textAlign: "center" }}>generating…</span>}
                {words.map((w, i) => (
                  <span key={i} style={{ ...mono, fontSize: "var(--text-sm)", display: "flex", gap: 6 }}>
                    <span style={{ color: "var(--muted)", width: 16, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>{w}
                  </span>
                ))}
              </div>

              <button className="btn btn-ghost btn-sm" onClick={copy} disabled={!phrase} style={{ alignSelf: "flex-start" }}>
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy phrase</>}
              </button>

              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: "var(--text-sm)", cursor: "pointer" }}>
                <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} style={{ width: 16, height: 16, marginTop: 2, accentColor: "var(--accent)" }} />
                I&apos;ve saved my recovery phrase somewhere safe. ENGYE can&apos;t recover it for me.
              </label>

              <button className="btn btn-primary" onClick={activate} disabled={!saved || busy || !recoveryAddress} aria-disabled={!saved || busy || !recoveryAddress}>
                {busy ? "Registering on-chain…" : "Activate recovery"}
              </button>
              {err && <p className="small" style={{ margin: 0, color: "var(--slash)" }}>{err}</p>}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
