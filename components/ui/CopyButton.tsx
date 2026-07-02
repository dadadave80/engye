"use client";
import { useState, type CSSProperties } from "react";
import { Copy, Check } from "lucide-react";

export function CopyButton({ text, style }: { text: string; style?: CSSProperties }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={copied ? "Copied" : "Copy"}
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      style={style}
    >
      {copied ? <Check size={13} color="var(--success)" /> : <Copy size={13} />}
    </button>
  );
}
