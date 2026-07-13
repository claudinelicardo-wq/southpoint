import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./config";

/**
 * Service-role client for server-only administration (staff account creation).
 * SUPABASE_SERVICE_ROLE_KEY is never exposed to the browser — this module is
 * guarded by the "server-only" import.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createSupabaseClient(supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
