"use server";

import { getWorkspaceContext } from "@/lib/data/workspace";
import {
  pageSize,
  toActivityEntries,
  type ActivityEntry,
} from "@/lib/server/copilot/activity";
import { recentAuditEvents } from "@/lib/server/copilot/audit";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

/**
 * The workspace's own history, for the owner who asked for it.
 *
 * Read through the signed-in user's client rather than the service role, so
 * row-level security decides which rows come back instead of this action
 * being trusted to filter correctly. The tenant comes from the verified
 * session, never from the caller — a browser cannot ask for another
 * workspace's history by passing a different id, because it passes none.
 */
export type ActivitySnapshot =
  | { state: "unavailable" }
  | { state: "signed_out" }
  | { state: "ready"; entries: ActivityEntry[] };

export async function getRecentActivity(
  limit?: unknown,
): Promise<ActivitySnapshot> {
  if (!isSupabaseConfigured()) return { state: "unavailable" };
  try {
    const supabase = await createClient();
    // Authentication and membership are re-checked here rather than assumed
    // from the page that rendered the panel.
    const context = await getWorkspaceContext(supabase);
    if (!context) return { state: "signed_out" };

    const events = await recentAuditEvents(
      supabase,
      context.tenantId,
      pageSize(limit),
    );
    return {
      state: "ready",
      entries: toActivityEntries(events, context.userId),
    };
  } catch {
    // Same answer as a missing session: the panel shows the signed-out
    // prompt rather than an error the owner can do nothing about.
    return { state: "signed_out" };
  }
}
