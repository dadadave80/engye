import { defineTool } from "eve/tools";
import { z } from "zod";
import { supabaseAdmin } from "../../lib/db";

export default defineTool({
  description: "Look up a match by its 0x… match key: status, verdict, and receipt links.",
  inputSchema: z.object({ match_key: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
  async execute({ match_key }) {
    if (!supabaseAdmin) return { error: "persistence unavailable" };
    const { data: m, error } = await supabaseAdmin
      .from("matches")
      .select("status,bond_usdc,price_usdc,verdict_due_at,bond_tx,settle_tx,refund_tx,stake_slash_tx,validations(pass,score,reasons)")
      .eq("match_key", match_key).maybeSingle();
    // distinguish a transient lookup failure from a genuine miss — don't tell the user "no match"
    // when the DB just hiccuped (they'd give up on a match that exists).
    if (error) return { error: `lookup failed, try again: ${error.message}` };
    if (!m) return { error: "no match with that key" };
    return { ...m, watch_url: `/m/${match_key}` };
  },
});
