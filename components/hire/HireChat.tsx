"use client";
// The front door: chat with the broker (eve agent), get a bonded quote, accept, watch receipts.
// The agent only converses+quotes; Accept pays through the deterministic rails (QuoteCard).
// Visuals adopted from design-system/import/chat/{ChatMessage,ChatComposer,TypingIndicator,ChatSuggestions}.jsx.
import { useEveAgent, type EveMessagePart } from "eve/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp } from "lucide-react";
import { Button, Eyebrow } from "../ui/primitives";
import { QuoteCard } from "./QuoteCard";

const STARTERS = [
  { label: "Summarize a Link", text: "Summarize this article into 3 bullets: https://" },
  { label: "Extract JSON", text: "Extract {name, price} from this text: " },
  { label: "Draft an Email", text: "Write a short email declining a meeting politely because " },
  { label: "Review Code", text: "Review this function for bugs:\n```\n\n```" },
  {
    label: "Settle a Stream Session",
    text: 'Compute the stream session settlement statement from this event log. Return JSON {per_viewer, total_seconds, total_usdc, recipients}:\n```json\n{"rate_usdc_per_second":0.0001,"events":[{"viewer":"alice","event":"joined","t":0},{"viewer":"bob","event":"joined","t":45},{"viewer":"alice","event":"parted","t":340},{"viewer":"carol","event":"joined","t":300},{"viewer":"bob","event":"parted","t":480},{"viewer":"carol","event":"parted","t":600}],"recipients":[{"name":"streamer","share":0.9},{"name":"platform","share":0.1}]}\n```',
  },
];

/* Internal — the assistant mark. Inlined (not exported) to avoid asset-path coupling. */
function ObolAvatar({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="11" fill="#191511" stroke="#B7892C" strokeWidth="1.5" />
      <circle cx="8.5" cy="10.5" r="3" fill="none" stroke="#B7892C" strokeWidth="1.25" />
      <circle cx="15.5" cy="10.5" r="3" fill="none" stroke="#B7892C" strokeWidth="1.25" />
      <circle cx="8.5" cy="10.5" r="1" fill="#B7892C" />
      <circle cx="15.5" cy="10.5" r="1" fill="#B7892C" />
      <path d="M 10.5 14 L 13.5 14 L 12 17 Z" fill="#B7892C" />
    </svg>
  );
}

/* User bubble = right-aligned secondary; assistant = obol avatar + column of parts. */
function UserMessage({ children }: { children: ReactNode }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ display: "flex", justifyContent: "flex-end" }}>
      <div style={{ maxWidth: "80%", background: "var(--secondary)", color: "var(--secondary-foreground)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 15, lineHeight: 1.5 }}>
        {children}
      </div>
    </div>
  );
}

function AssistantTurn({ children }: { children: ReactNode }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <ObolAvatar />
      <div style={{ flex: 1, minWidth: 0, paddingTop: 2, display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}

function TypingIndicator() {
  const dot = (delay: number) => (
    <span className="typing-dot" style={{ width: 6, height: 6, borderRadius: 999, background: "var(--muted-foreground)", display: "inline-block", animationDelay: `${delay}s` }} />
  );
  return (
    <div className="animate-in fade-in duration-200" style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <ObolAvatar />
      <div style={{ display: "inline-flex", gap: 5, alignItems: "center", background: "var(--secondary)", borderRadius: 999, padding: "9px 13px" }}>
        {dot(0)}{dot(0.2)}{dot(0.4)}
      </div>
    </div>
  );
}

function SuggestionChip({ label, onClick }: { label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button" onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className="animate-in fade-in zoom-in-95 duration-300"
      style={{
        fontFamily: "var(--font-body)", fontSize: 14, padding: "9px 16px", cursor: "pointer",
        background: hover ? "var(--secondary)" : "var(--card)", color: "var(--foreground)",
        border: "1px solid var(--border)", borderRadius: 999,
        transition: "background-color var(--dur) var(--ease)",
      }}>
      {label}
    </button>
  );
}

function Composer({ value, onChange, onSubmit, disabled }: { value: string; onChange: (v: string) => void; onSubmit: () => void; disabled: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [value]);

  const submit = () => { if (value.trim() && !disabled) onSubmit(); };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}
      style={{
        display: "flex", gap: 10, alignItems: "flex-end",
        background: "var(--card)", border: "1px solid var(--input)", borderRadius: "var(--radius)",
        padding: "8px 8px 8px 14px",
      }}>
      <textarea
        ref={ref} value={value} rows={1} className="focus-ring" placeholder="e.g. summarize https://… into 3 bullets" disabled={disabled}
        aria-label="Message ENGYE"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        style={{
          flex: 1, border: "none", outline: "none", background: "transparent",
          color: "var(--foreground)", fontSize: 15, fontFamily: "var(--font-body)", lineHeight: 1.5,
          resize: "none", maxHeight: 160, minWidth: 0, padding: "6px 0",
        }}
      />
      <Button type="submit" size="sm" disabled={!value.trim() || disabled} aria-label="Send" style={{ padding: "8px 12px", minHeight: 38 }}>
        <ArrowUp size={16} aria-hidden="true" />
      </Button>
    </form>
  );
}

function Part({ part }: { part: EveMessagePart }) {
  if (part.type === "text") return <p style={{ margin: 0, lineHeight: 1.55, fontSize: 15, color: "var(--foreground)", whiteSpace: "pre-wrap", textWrap: "pretty" }}>{part.text}</p>;
  if (part.type === "dynamic-tool" && part.state === "output-available" && part.toolName === "get_quote") {
    return <QuoteCard output={part.output as Record<string, unknown>} />;
  }
  if (part.type === "dynamic-tool" && part.state === "input-available") {
    return <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>… consulting the registry</div>;
  }
  // a tool that errored or was denied would otherwise render nothing — leave the user with a gap
  if (part.type === "dynamic-tool" && (part.state === "output-error" || part.state === "output-denied")) {
    return <div style={{ fontSize: 12.5, color: "var(--destructive)" }}>that step didn&apos;t complete — try rephrasing your request.</div>;
  }
  return null;
}

export function HireChat() {
  const agent = useEveAgent();
  const [draft, setDraft] = useState("");
  const busy = agent.status === "submitted" || agent.status === "streaming";
  const empty = agent.data.messages.length === 0;

  async function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    await agent.send({ message: text });
  }

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <Eyebrow>Hire ENGYE — quotes are free, every job is bonded</Eyebrow>

      <div aria-live="polite" aria-atomic="false" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {empty && (
          <>
            <AssistantTurn>
              <p style={{ margin: 0, lineHeight: 1.55, fontSize: 15, color: "var(--foreground)" }}>
                Describe a task. I&apos;ll route it, price it, and stake my own USDC on the result — if my validator rejects the work, you&apos;re paid back price + bond, on-chain.
              </p>
            </AssistantTurn>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginLeft: 38 }}>
              {STARTERS.map((s) => <SuggestionChip key={s.label} label={s.label} onClick={() => setDraft(s.text)} />)}
            </div>
          </>
        )}

        {agent.data.messages.map((m) =>
          m.role === "user" ? (
            <UserMessage key={m.id}>
              {m.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
            </UserMessage>
          ) : (
            <AssistantTurn key={m.id}>
              {m.parts.map((p, i) => <Part key={i} part={p} />)}
            </AssistantTurn>
          )
        )}

        {busy && <TypingIndicator />}
      </div>

      {agent.error && <div style={{ fontSize: 13, color: "var(--destructive)" }}>{agent.error.message}</div>}

      <Composer value={draft} onChange={setDraft} onSubmit={submit} disabled={busy} />
    </div>
  );
}
