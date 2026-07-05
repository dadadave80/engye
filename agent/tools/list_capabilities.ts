import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "The exact task catalog ENGYE can broker right now.",
  inputSchema: z.object({}),
  async execute() {
    return {
      tasks: ["summarize (text or URL)", "answer", "extract → strict JSON", "write/rewrite", "code (explain/review/draft)"],
      cannot: ["web search", "fresh data (prices/news/weather)", "files/images"],
      guarantee: "every accepted task is backed by a USDC bond, auto-paid to you if validation fails",
    };
  },
});
