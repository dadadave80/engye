import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Degrades gracefully until the Supabase project is linked: callers must null-check.
export const supabaseAdmin: SupabaseClient | null =
  url && serviceKey ? createClient(url, serviceKey) : null;

if (!supabaseAdmin) {
  console.warn("[db] Supabase env missing — persistence disabled");
}
