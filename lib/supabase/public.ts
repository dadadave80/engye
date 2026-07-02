// Public read client — anon key, RLS allows select on all dashboard tables.
// Used by server components (initial render) and the browser (realtime).
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export const supabasePublic = () => createClient(url, anon, { auth: { persistSession: false } });
export const ARCSCAN = "https://testnet.arcscan.app";
export const txUrl = (h?: string | null) => (h ? `${ARCSCAN}/tx/${h}` : undefined);
