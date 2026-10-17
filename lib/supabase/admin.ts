import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabasePublicConfig } from "./config";

// Service-role client for server-owned tables (usage ledger, limits).
// Never import from client code; never use it for tenant content reads,
// which must go through the signed-in user's RLS-scoped client.
export function createAdminClient(secretKey: string) {
  const { url } = getSupabasePublicConfig();
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
