"use client";
// Porto-style connect modal: Continue with Porto (passkey) · Switch account · Sign up,
// plus a browser-wallet (EOA) option for the x402 pay flow. Backed by the Porto Key +
// self-relay flow (the authentic id.porto.sh dialog can't serve Arc — see the design note).
import { useState } from "react";
import { useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { ScanFace, Fingerprint, Wallet, Check, X, ChevronRight, ExternalLink } from "lucide-react";
import { usePasskey, type PasskeySession } from "./passkey";
import { signUpPasskey, loginPasskey } from "./passkeyClient";
import { circleConfigured } from "@/lib/circleWallet";

const trunc = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 };
const card: React.CSSProperties = { width: 380, maxWidth: "92vw", background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)", borderRadius: "calc(var(--radius) * 1.5)", boxShadow: "var(--shadow-popover)", overflow: "hidden", fontFamily: "var(--font-body)" };
const primaryBtn: React.CSSProperties = { width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 16px", borderRadius: "var(--radius)", background: "var(--aegean)", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const link: React.CSSProperties = { background: "none", border: "none", color: "var(--link)", fontSize: 13, cursor: "pointer", padding: 0, fontWeight: 500 };
const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };

export function ConnectModal({ onClose }: { onClose: () => void }) {
  const { accounts, current, addAccount, switchTo } = usePasskey();
  const { connect } = useConnect();
  const [view, setView] = useState<"main" | "switch">("main");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  // Circle username rule: 5–50 chars, alphanumeric + _@.:+- (an email fits; it becomes the passkey's
  // identity in Google Password Manager / the authenticator).
  const emailOk = /^[A-Za-z0-9_@.:+-]{5,50}$/.test(email.trim());

  const active = current ?? accounts[0] ?? null;
  const configured = circleConfigured();

  async function run(fn: () => Promise<PasskeySession>) {
    setBusy(true); setErr(null);
    try {
      addAccount(await fn()); // becomes current
      onClose();
    } catch (e) {
      // surface the WebAuthn cause behind any generic wrapper
      const cause = (e as { cause?: { message?: string } })?.cause?.message?.split("\n")[0];
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      setErr(cause && cause !== msg ? `${msg} (${cause})` : msg);
    } finally { setBusy(false); }
  }
  const signUp = () => { if (emailOk) run(() => signUpPasskey(email.trim())); else setErr("Enter your email to create a passkey."); };

  function continueWith() {
    if (active) { switchTo(active.address); onClose(); } // known device → no re-prompt
    else run(loginPasskey); // returning user, no local session → pick an existing passkey
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted-foreground)", ...mono }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/obol-mark.svg" width={16} height={16} alt="" /> engye.vercel.app
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", display: "inline-flex" }}><X size={16} /></button>
        </div>

        {view === "switch" ? (
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Switch Account</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {accounts.map((a) => (
                <button key={a.address} onClick={() => { switchTo(a.address); onClose(); }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: a.address === current?.address ? "var(--secondary)" : "transparent", cursor: "pointer", color: "var(--foreground)" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Fingerprint size={15} color="var(--aegean-lifted)" />
                    <span style={{ ...mono, fontSize: 13 }}>{trunc(a.address)}</span>
                  </span>
                  {a.address === current?.address && <Check size={15} color="var(--success)" />}
                </button>
              ))}
              <button onClick={() => setView("main")} style={{ ...link, marginTop: 6, alignSelf: "flex-start" }}>← Back</button>
            </div>
          </div>
        ) : (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 600 }}>
                <ScanFace size={18} color="var(--aegean-lifted)" /> Sign in with a passkey
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                A smart account secured by your device (Face ID / fingerprint) — powered by Circle Modular Wallets on Arc. Gas is sponsored by Circle Gas Station; first tasks are on us.
              </p>
            </div>

            {configured ? (
              active ? (
                <>
                  <button style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={continueWith}>
                    <ScanFace size={16} /> {busy ? "Waiting for passkey…" : "Continue with Passkey"}
                  </button>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, color: "var(--muted-foreground)" }}>
                    <span style={mono}>Using {trunc(active.address)}</span>
                    <span style={{ display: "inline-flex", gap: 12 }}>
                      {accounts.length > 1 && <button style={link} onClick={() => setView("switch")}>Switch</button>}
                      <button style={link} disabled={busy} onClick={() => run(loginPasskey)}>Add another</button>
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <input type="email" inputMode="email" autoComplete="email" placeholder="you@email.com"
                    value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email"
                    onKeyDown={(e) => { if (e.key === "Enter") signUp(); }}
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14, fontFamily: "var(--font-mono)", background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--input)", borderRadius: "var(--radius)", outline: "none" }} />
                  <button style={{ ...primaryBtn, opacity: busy || !emailOk ? 0.7 : 1 }} disabled={busy || !emailOk} onClick={signUp}>
                    <ScanFace size={16} /> {busy ? "Waiting for passkey…" : "Create Passkey"}
                  </button>
                  <button style={{ ...link, alignSelf: "center" }} disabled={busy} onClick={() => run(loginPasskey)}>Already have a passkey? Sign in →</button>
                </>
              )
            ) : (
              <div style={{ padding: "10px 12px", borderRadius: "var(--radius)", border: "1px dashed var(--border)", fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                Passkey sign-in is being configured. Use a browser wallet below in the meantime.
              </div>
            )}

            {/* browser wallet (EOA) — a full first-class option: fund it and pay/stake directly.
                Mobile browsers have no injected provider (no extensions) — show the real path
                (the wallet app's in-app browser) instead of a silently-dead button. */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {typeof window !== "undefined" && (window as { ethereum?: unknown }).ethereum ? (
                <button onClick={() => { connect({ connector: injected() }); onClose(); }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "transparent", cursor: "pointer", color: "var(--foreground)" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14 }}><Wallet size={16} /> Browser Wallet</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted-foreground)" }}>injected wallet <ChevronRight size={14} /></span>
                </button>
              ) : (
                <div style={{ padding: "10px 12px", borderRadius: "var(--radius)", border: "1px dashed var(--border)", color: "var(--muted-foreground)" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--foreground)" }}><Wallet size={16} /> Browser Wallet</span>
                  <p style={{ margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.5 }}>
                    No wallet found in this browser. On mobile, open <span style={mono}>engye.vercel.app</span>{" "}
                    inside your wallet app&apos;s browser (e.g. MetaMask → menu → Browser) — or use a passkey above; first tasks are sponsored.
                  </p>
                </div>
              )}
              <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted-foreground)", textDecoration: "none", lineHeight: 1.4 }}>
                New to Arc? Fund your wallet with testnet USDC — <span style={{ color: "var(--link)" }}>Circle Faucet</span> <ExternalLink size={11} /> <span>(pick Arc Testnet)</span>
              </a>
            </div>

            {err && <div style={{ fontSize: 12.5, color: "var(--oxblood-badge)" }}>{err}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
