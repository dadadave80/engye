"use client";
// Header wallet control (handoff .wallet-btn/.wallet-menu), wired to the REAL flow:
// disconnected → "Connect" opens ConnectModal; connected → laurel-dot + truncated address
// with a role="menu" dropdown (View account · Copy address · [Switch] · Add/sign up · Disconnect).
// Replaces the design kit's engye-wallet.js mock. Disconnect is not cinnabar (it isn't a slash).
import { useEffect, useRef, useState } from "react";
import { useDisconnect } from "wagmi";
import { useWallet } from "./useWallet";
import { usePasskey } from "./passkey";
import { ConnectModal } from "./ConnectModal";

const trunc = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function WalletControl() {
  const wallet = useWallet();
  const { disconnect } = useDisconnect();
  const { accounts, signOut } = usePasskey();
  const [modal, setModal] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const copy = async () => {
    if (!wallet.address) return;
    try { await navigator.clipboard.writeText(wallet.address); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = wallet.address; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch {} document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  if (wallet.connected && wallet.address) {
    return (
      <div className="wallet" ref={wrapRef}>
        <button type="button" className="wallet-btn" aria-haspopup="menu" aria-expanded={open}
          aria-label={`Wallet ${trunc(wallet.address)} — open menu`} onClick={() => setOpen((o) => !o)}>
          <span className="dot" />
          <span className="num">{trunc(wallet.address)}</span>
          <span className="caret">▾</span>
        </button>
        <div className={`wallet-menu${open ? " open" : ""}`} role="menu">
          <div className="addr">{wallet.address}</div>
          <a href="/account" role="menuitem" onClick={() => setOpen(false)}>View account</a>
          <button type="button" role="menuitem" onClick={copy}>{copied ? "Copied ✓" : "Copy address"}</button>
          {wallet.kind === "passkey" && accounts.length > 1 && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); setModal(true); }}>Switch account</button>
          )}
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setModal(true); }}>Add / sign up</button>
          <button type="button" role="menuitem" onClick={() => { wallet.kind === "eoa" ? disconnect() : signOut(); setOpen(false); }}>Disconnect</button>
        </div>
        {modal && <ConnectModal onClose={() => setModal(false)} />}
      </div>
    );
  }

  return (
    <div className="wallet">
      <button type="button" className="wallet-btn is-connect" aria-label="Connect a wallet" onClick={() => setModal(true)}>Connect</button>
      {modal && <ConnectModal onClose={() => setModal(false)} />}
    </div>
  );
}
