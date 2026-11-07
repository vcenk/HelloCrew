import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptSecret, encryptSecret } from "./secrets";

export type ConnectionKind =
  | "facebook_page"
  | "instagram"
  | "whatsapp"
  | "google_location"
  | "google_calendar";

export type Connection<C = Record<string, unknown>> = {
  tenantId: string;
  id: string;
  provider: "meta" | "google";
  kind: ConnectionKind;
  externalId: string;
  displayName: string;
  status: "connected" | "error" | "disconnected";
  settings: Record<string, unknown>;
  credentials: C | null;
};

type Row = Record<string, unknown>;

function toConnection<C>(row: Row): Connection<C> {
  let credentials: C | null = null;
  if (typeof row.credentials === "string") {
    try {
      credentials = decryptSecret<C>(row.credentials);
    } catch {
      credentials = null;
    }
  }
  return {
    tenantId: row.tenant_id as string,
    id: row.id as string,
    provider: row.provider as Connection["provider"],
    kind: row.kind as ConnectionKind,
    externalId: row.external_id as string,
    displayName: row.display_name as string,
    status: row.status as Connection["status"],
    settings: (row.settings as Record<string, unknown>) ?? {},
    credentials,
  };
}

export class ConnectionTakenError extends Error {
  constructor(name: string) {
    super(`${name} is already connected to another HelloCrew workspace.`);
  }
}

// Saves (or refreshes) a connection for a workspace. A page/account/number can
// belong to one workspace only, so incoming events always route to one place.
export async function saveConnection(
  admin: SupabaseClient,
  input: {
    tenantId: string;
    provider: Connection["provider"];
    kind: ConnectionKind;
    externalId: string;
    displayName: string;
    credentials: unknown;
    settings?: Record<string, unknown>;
    createdBy: string;
  },
) {
  const { data: existing } = await admin
    .from("hc_channel_connections")
    .select("tenant_id, id")
    .eq("kind", input.kind)
    .eq("external_id", input.externalId)
    .maybeSingle();
  if (existing && existing.tenant_id !== input.tenantId) throw new ConnectionTakenError(input.displayName);
  const values = {
    provider: input.provider,
    display_name: input.displayName.slice(0, 200),
    status: "connected",
    credentials: encryptSecret(input.credentials),
    settings: input.settings ?? {},
    last_error: null,
  };
  if (existing) {
    const { error } = await admin
      .from("hc_channel_connections")
      .update(values)
      .eq("tenant_id", input.tenantId)
      .eq("id", existing.id as string);
    if (error) throw new Error("Couldn’t save the connection.");
    return existing.id as string;
  }
  const { data, error } = await admin
    .from("hc_channel_connections")
    .insert({
      ...values,
      tenant_id: input.tenantId,
      kind: input.kind,
      external_id: input.externalId,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("Couldn’t save the connection.");
  return data.id as string;
}

export async function findConnection<C>(admin: SupabaseClient, kind: ConnectionKind, externalId: string) {
  const { data } = await admin
    .from("hc_channel_connections")
    .select("*")
    .eq("kind", kind)
    .eq("external_id", externalId)
    .eq("status", "connected")
    .maybeSingle();
  return data ? toConnection<C>(data) : null;
}

export async function getConnection<C>(admin: SupabaseClient, tenantId: string, id: string) {
  const { data } = await admin
    .from("hc_channel_connections")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  return data ? toConnection<C>(data) : null;
}

/** Every connection of one kind for a workspace, newest first. */
export async function listConnectionsFor<C>(
  admin: SupabaseClient,
  tenantId: string,
  kind: ConnectionKind,
) {
  const { data } = await admin
    .from("hc_channel_connections")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("kind", kind)
    .order("created_at", { ascending: false });
  return (data ?? []).map((row) => toConnection<C>(row));
}

export async function markConnectionError(admin: SupabaseClient, tenantId: string, id: string, message: string) {
  await admin
    .from("hc_channel_connections")
    .update({ last_error: message.slice(0, 300) })
    .eq("tenant_id", tenantId)
    .eq("id", id);
}

export type EventClaim = "claimed" | "completed" | "locked";

/**
 * Record that a delivery arrived, before any work is done with it.
 *
 * Called inside the request, before the 200. The provider is told the
 * delivery succeeded and will not send it again, so if the invocation is cut
 * off during `after` this row is the only thing that knows the event existed.
 * The payload is kept so the sweeper has something to replay, and is cleared
 * the moment the work completes.
 */
export async function receiveEvent(
  admin: SupabaseClient,
  provider: "meta" | "google",
  eventId: string,
  payload: unknown,
) {
  const { error } = await admin.rpc("hc_receive_webhook_event", {
    p_provider: provider,
    p_event_id: eventId.slice(0, 300),
    p_payload: payload,
  });
  if (error) throw new Error("Couldn’t record the event.");
}

/** Accepted deliveries that were never finished and whose lease has expired. */
export async function stuckEvents(
  admin: SupabaseClient,
  provider: "meta" | "google",
  limit = 20,
): Promise<{ eventId: string; payload: unknown; attempts: number }[]> {
  const { data, error } = await admin.rpc("hc_stuck_webhook_events", {
    p_provider: provider,
    p_limit: limit,
  });
  if (error) throw new Error("Couldn’t read unfinished events.");
  return ((data ?? []) as { event_id: string; payload: unknown; attempts: number }[]).map(
    (row) => ({ eventId: row.event_id, payload: row.payload, attempts: row.attempts }),
  );
}

/**
 * Take ownership of one provider delivery.
 *
 * Replaces an insert-and-hope: the old version recorded the event id before
 * any of the work, so a failure after that point was permanent — the
 * provider's retry carried the same id, the insert conflicted, and the
 * message was gone. Now the row carries a lease and a status, so only a
 * `completed` event is refused.
 *
 * 'claimed' means process it. 'completed' means it is already done and must
 * not be repeated. 'locked' means another worker holds a live lease, so this
 * delivery should be left alone; the provider will retry if that worker dies,
 * and the expired lease will let the retry through.
 */
export async function claimEvent(
  admin: SupabaseClient,
  provider: "meta" | "google",
  eventId: string,
  leaseSeconds = 120,
): Promise<EventClaim> {
  const { data, error } = await admin.rpc("hc_claim_webhook_event", {
    p_provider: provider,
    p_event_id: eventId.slice(0, 300),
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error("Couldn’t record the event.");
  return (data as EventClaim | null) ?? "locked";
}

/** The work is done. Nothing will process this delivery again. */
export async function completeEvent(
  admin: SupabaseClient,
  provider: "meta" | "google",
  eventId: string,
) {
  const { error } = await admin.rpc("hc_complete_webhook_event", {
    p_provider: provider,
    p_event_id: eventId.slice(0, 300),
  });
  if (error) console.error("[webhook] could not mark complete:", error.message);
}

/**
 * The attempt failed. Releases the lease so a retry can pick it up.
 *
 * `reason` is stored, so it must name the step and nothing else — never a
 * token, never the customer's message.
 */
export async function failEvent(
  admin: SupabaseClient,
  provider: "meta" | "google",
  eventId: string,
  reason: string,
  retryable = true,
) {
  const { error } = await admin.rpc("hc_fail_webhook_event", {
    p_provider: provider,
    p_event_id: eventId.slice(0, 300),
    p_reason: reason.slice(0, 300),
    p_retryable: retryable,
  });
  if (error) console.error("[webhook] could not mark failed:", error.message);
}
