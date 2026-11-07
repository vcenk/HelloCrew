import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One automated turn per conversation at a time.
 *
 * The lease lives in the database rather than in a process, because two
 * serverless instances holding separate in-memory locks is the same as no
 * lock at all. Every function here is a single statement on the server, so
 * two callers racing cannot both win.
 */

/** Long enough for a slow model turn, short enough that a dead worker frees up. */
export const TURN_LEASE_SECONDS = 90;

/**
 * Take the turn, or get null.
 *
 * Null means the conversation is not this worker's to answer: another turn
 * holds a live lease, or a person has taken it over. The caller does not
 * need to tell those apart — neither permits an automated reply.
 */
export async function claimTurn(
  admin: SupabaseClient,
  tenantId: string,
  conversationId: string,
  leaseSeconds = TURN_LEASE_SECONDS,
): Promise<string | null> {
  const { data, error } = await admin.rpc("hc_claim_conversation_turn", {
    p_tenant_id: tenantId,
    p_conversation_id: conversationId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    // Fail closed. A duplicate reply to a real customer is worse than a late
    // one, and the customer's message is stored either way.
    console.error("[turn] could not claim:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

/** Give the turn back. Scoped to the owner, so a late worker cannot free someone else's lease. */
export async function releaseTurn(
  admin: SupabaseClient,
  tenantId: string,
  conversationId: string,
  owner: string,
) {
  const { error } = await admin.rpc("hc_release_conversation_turn", {
    p_tenant_id: tenantId,
    p_conversation_id: conversationId,
    p_owner: owner,
  });
  // Not fatal: the lease expires on its own, which is the whole point of
  // having one rather than a flag.
  if (error) console.error("[turn] could not release:", error.message);
}

/**
 * Whether this turn is still allowed to speak.
 *
 * False once a person has taken the conversation over, or once the lease
 * expired and another worker took it. Asked after the model returns and
 * before the reply is stored or sent, because a turn takes seconds and a
 * takeover inside that window is exactly what it is for.
 */
export async function turnStillValid(
  admin: SupabaseClient,
  tenantId: string,
  conversationId: string,
  owner: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("hc_turn_still_valid", {
    p_tenant_id: tenantId,
    p_conversation_id: conversationId,
    p_owner: owner,
  });
  if (error) {
    console.error("[turn] could not confirm ownership:", error.message);
    return false; // fail closed
  }
  return data === true;
}
