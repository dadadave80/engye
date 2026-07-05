"use client";
// The front door: chat with the broker (eve agent), get a bonded quote, accept, watch receipts.
// UI = assistant-ui (@assistant-ui/react) thread primitives, ENGYE-skinned (marble/ink tokens,
// Cinzel greeting, obol avatar). Runtime = ExternalStore adapter over eve/react's useEveAgent —
// the agent only converses+quotes; Accept pays through the deterministic rails (QuoteCard).
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
  type AppendMessage,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { useEveAgent, type EveMessage } from "eve/react";
import { ArrowUp, Link2, Braces, Mail, Code2, Radio, type LucideIcon } from "lucide-react";
import { Eyebrow } from "../ui/primitives";
import { QuoteCard } from "./QuoteCard";

const STARTERS: { label: string; icon: LucideIcon; text: string }[] = [
  { label: "Summarize a Link", icon: Link2, text: "Summarize this article into 3 bullets: https://" },
  { label: "Extract JSON", icon: Braces, text: "Extract {name, price} from this text: " },
  { label: "Draft an Email", icon: Mail, text: "Write a short email declining a meeting politely because " },
  { label: "Review Code", icon: Code2, text: "Review this function for bugs:\n```\n\n```" },
  {
    label: "Settle a Stream Session",
    icon: Radio,
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

/* ---- eve → assistant-ui message conversion ---- */
type PartLike = Exclude<ThreadMessageLike["content"], string>[number];
type ToolCallArgs = Extract<PartLike, { type: "tool-call" }>["args"];
function convertMessage(m: EveMessage): ThreadMessageLike {
  const content: PartLike[] = [];
  for (const p of m.parts) {
    if (p.type === "text" && p.text) content.push({ type: "text", text: p.text });
    else if (p.type === "dynamic-tool") {
      const failed = p.state === "output-error" || p.state === "output-denied";
      content.push({
        type: "tool-call",
        toolCallId: p.toolCallId,
        toolName: p.toolName,
        args: (p.input ?? {}) as ToolCallArgs,
        // error states become a result so QuoteCard renders its error card instead of a dead gap
        result: p.state === "output-available" ? p.output : failed ? { error: "that step didn't complete — try rephrasing your request." } : undefined,
        isError: failed,
      });
    }
  }
  if (content.length === 0) content.push({ type: "text", text: "" });
  return { role: m.role === "user" ? "user" : "assistant", id: m.id, content };
}

/* ---- tool renderers ---- */
function GetQuoteTool({ result, status }: ToolCallMessagePartProps) {
  if (status.type === "running" || result === undefined) {
    return <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>… consulting the registry</div>;
  }
  return <QuoteCard output={result as Record<string, unknown>} />;
}
function GenericTool({ result, status, isError }: ToolCallMessagePartProps) {
  if (status.type === "running" || result === undefined) {
    return <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>… working</div>;
  }
  if (isError) {
    return <div style={{ fontSize: 12.5, color: "var(--destructive)" }}>that step didn&apos;t complete — try rephrasing your request.</div>;
  }
  return null;
}
const PART_COMPONENTS = {
  Text: ({ text }: { text: string }) => (
    <p style={{ margin: 0, lineHeight: 1.55, fontSize: 15, whiteSpace: "pre-wrap", textWrap: "pretty" }}>{text}</p>
  ),
  tools: { by_name: { get_quote: GetQuoteTool }, Fallback: GenericTool },
};

/* Text-only renderer for user bubbles (tool parts never appear on user turns). */
function UserText({ text }: { text: string }) {
  return <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text}</span>;
}

/* ---- messages ---- */
function UserMessage() {
  return (
    <MessagePrimitive.Root className="animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ display: "flex", justifyContent: "flex-end" }}>
      <div style={{ maxWidth: "80%", minWidth: 0, background: "var(--secondary)", color: "var(--secondary-foreground)", borderRadius: "var(--radius)", padding: "10px 14px", fontSize: 15, lineHeight: 1.5, overflowWrap: "anywhere" }}>
        <MessagePrimitive.Parts components={{ Text: UserText }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <ObolAvatar />
      <div style={{ flex: 1, minWidth: 0, paddingTop: 2, display: "flex", flexDirection: "column", gap: 10, color: "var(--foreground)" }}>
        <MessagePrimitive.Parts components={PART_COMPONENTS} />
      </div>
    </MessagePrimitive.Root>
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

export function HireChat() {
  const agent = useEveAgent();
  const busy = agent.status === "submitted" || agent.status === "streaming";

  const runtime = useExternalStoreRuntime({
    messages: agent.data.messages,
    isRunning: busy,
    convertMessage,
    onNew: async (m: AppendMessage) => {
      const text = m.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n")
        .trim();
      if (text) await agent.send({ message: text });
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", height: "calc(100dvh - 160px)", minHeight: 420 }}>
        <div style={{ marginBottom: 16 }}>
          <Eyebrow>Hire ENGYE — quotes are free, every job is bonded</Eyebrow>
        </div>

        <ThreadPrimitive.Viewport aria-live="polite" aria-atomic="false" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20, paddingBottom: 20, scrollbarWidth: "thin" }}>
          <ThreadPrimitive.Empty>
            {/* centered greeting, screenshot-style, in ENGYE's voice */}
            <div className="animate-in fade-in duration-300" style={{ margin: "auto 0", textAlign: "center", display: "flex", flexDirection: "column", gap: 14, padding: "32px 8px" }}>
              <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(1.6rem, 4vw, 2.4rem)", letterSpacing: "var(--tracking-display)", lineHeight: 1.2 }}>
                WHAT SHALL I UNDERWRITE?
              </h2>
              <p style={{ margin: "0 auto", maxWidth: 480, fontSize: 15, lineHeight: 1.55, color: "var(--muted-foreground)", textWrap: "pretty" }}>
                Describe a task. I route it, price it, and stake my own USDC on the result — if my validator rejects the work, you&apos;re paid back price + bond, on-chain.
              </p>
            </div>
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          <ThreadPrimitive.If running>
            <TypingIndicator />
          </ThreadPrimitive.If>
        </ThreadPrimitive.Viewport>

        {agent.error && <div style={{ fontSize: 13, color: "var(--destructive)", marginBottom: 8 }}>{agent.error.message}</div>}

        {/* assistant-ui composer card: input on top, control row below (screenshot layout) */}
        <ComposerPrimitive.Root className="aui-composer" style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--card)", border: "1px solid var(--input)", borderRadius: "calc(var(--radius) * 2)", padding: "12px 12px 10px 14px" }}>
          <ComposerPrimitive.Input
            rows={1}
            maxRows={6}
            autoFocus
            placeholder="e.g. summarize https://… into 3 bullets"
            aria-label="Message ENGYE"
            style={{ border: "none", outline: "none", background: "transparent", color: "var(--foreground)", fontSize: 15, fontFamily: "var(--font-body)", lineHeight: 1.5, resize: "none", minWidth: 0, width: "100%", padding: "2px 0" }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted-foreground)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/obol-mark.svg" width={16} height={16} alt="" />
              ENGYE broker · bonded on Arc
            </span>
            <ComposerPrimitive.Send className="aui-send focus-ring" aria-label="Send" style={{ width: 36, height: 36, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 999, border: "none", background: "var(--primary)", color: "var(--primary-foreground)", cursor: "pointer", flexShrink: 0 }}>
              <ArrowUp size={16} aria-hidden="true" />
            </ComposerPrimitive.Send>
          </div>
        </ComposerPrimitive.Root>

        {/* suggestion pills under the composer (screenshot position), empty thread only */}
        <ThreadPrimitive.Empty>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 14 }}>
            {STARTERS.map((s) => (
              <ThreadPrimitive.Suggestion key={s.label} prompt={s.text} send={false} className="aui-pill animate-in fade-in zoom-in-95 duration-300 focus-ring"
                style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--font-body)", fontSize: 14, padding: "9px 16px", cursor: "pointer", background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 999 }}>
                <s.icon size={15} style={{ color: "var(--gold)" }} aria-hidden="true" />
                {s.label}
              </ThreadPrimitive.Suggestion>
            ))}
          </div>
        </ThreadPrimitive.Empty>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
