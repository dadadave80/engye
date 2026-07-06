import { defineTool } from "eve/tools";
import { z } from "zod";
import { demandStatus } from "../../../../lib/demand";

export default defineTool({
  description:
    "Read the demand desk's current day: daily budget, spent, remaining, and the most recent buy/skip judgments with reasons. Read-only — no signing needed.",
  inputSchema: z.object({}),
  async execute() {
    try {
      return await demandStatus();
    } catch (e) {
      return { error: `couldn't read demand status: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
});
