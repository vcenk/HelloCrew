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

// True the first time an event id is seen; providers retry deliveries.
export async function firstDelivery(admin: SupabaseClient, provider: "meta" | "google", eventId: string) {
  const { error } = await admin.from("hc_webhook_events").insert({ provider, event_id: eventId.slice(0, 300) });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error("Couldn’t record the event.");
}
