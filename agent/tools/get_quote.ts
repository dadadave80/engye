import { defineTool } from "eve/tools";
import { z } from "zod";
import { quoteTask } from "../../lib/broker";
import { rateLimit } from "../../lib/ratelimit-core";
import { fetchPageText, fenceUntrusted } from "../../lib/ingest";

export default defineTool({
  description:
    "Get a bonded quote from the ENGYE broker. Returns price, ENGYE's pass-confidence, and the USDC bond it will stake. Call once the task is clear (at most one clarifying question first).",
  inputSchema: z.object({
    task_type: z.enum(["summarize", "answer", "extract", "write", "code"]),
    spec: z.string().min(8).max(6000).describe("Complete task spec incl. any pasted content and, for extract, the desired JSON shape"),
    url: z.string().url().optional().describe("Optional public https URL whose text should be fetched into the spec"),
    max_price_usdc: z.number().positive().max(1).default(0.05),
  }),
  async execute({ task_type, spec, url, max_price_usdc }, ctx) {
    // The eve channel is public and the tool ctx can't see the caller IP, so per-session limiting
    // alone doesn't bound total LLM spend (an attacker just opens more sessions). A global cap on
    // quote volume across ALL sessions is the real cost-DoS backstop, on top of the per-session limit.
    if (!rateLimit("quote:global", 60, 60_000)) {
      return { error: "the broker is fielding a lot of requests right now — try again in a moment" };
    }
    if (!rateLimit(`quote:${ctx.session.id}`, 20, 60_000)) {
      return { error: "rate limited — try again in a minute" };
    }
    let fullSpec = spec;
    if (url) {
      try {
        fullSpec = `${spec}\n\n${fenceUntrusted(await fetchPageText(url))}`;
      } catch (e) {
        return { error: `could not fetch that URL: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    try {
      return await quoteTask({ type: task_type, spec: fullSpec, max_price_usdc }, null);
    } catch (e) {
      // quoteTask throws when the broker LLM fails (Groq rate-limit / schema-validation). Returning
      // a graceful {error} — not re-throwing — keeps this a successful tool result so the agent
      // relays ONE clear message instead of retry-looping get_quote (which burns TPM and hangs the
      // typing indicator). QuoteCard renders output.error.
      const msg = e instanceof Error ? e.message : String(e);
      return {
        error: /rate.?limit|TPM|\b429\b|try again in/i.test(msg)
          ? "the broker is briefly rate-limited — give it a few seconds and ask again"
          : "the broker couldn't price that one just now — try rephrasing, or send a smaller task",
      };
    }
  },
});
