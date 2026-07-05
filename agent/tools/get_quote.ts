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
    return quoteTask({ type: task_type, spec: fullSpec, max_price_usdc }, null);
  },
});
