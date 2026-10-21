import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getConnection, markConnectionError } from "./connections";
import { tokenFor, type MetaCredentials } from "./inbound";
import { readMetaConfig, sendDirectMessage } from "./meta";

const MESSAGING = new Set(["messenger", "instagram", "whatsapp"]);
const DAY_MS = 24 * 3600 * 1000;

export type DeliveryResult = { delivered: true } | { delivered: false; reason: string } | { delivered: null };

// Sends a message that was written inside HelloCrew (an approval outcome, an
// owner's reply) to the customer on the app they wrote from. Returns
// { delivered: null } for website/test chats, which need no delivery.
export async function deliverToCustomer(
  admin: SupabaseClient,
  tenantId: string,
  conversationId: string,
  text: string,
): Promise<DeliveryResult> {
  const { data: conversation } = await admin
    .from("hc_conversations")
    .select("id, channel, connection_id, external_thread_id")
    .eq("tenant_id", tenantId)
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation || !MESSAGING.has(conversation.channel as string)) return { delivered: null };

  const { data: last } = await admin
    .from("hc_messages")
    .select("created_at")
    .eq("tenant_id", tenantId)
    .eq("conversation_id", conversationId)
    .eq("role", "customer")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last || Date.now() - Date.parse(last.created_at as string) > DAY_MS)
    return { delivered: false, reason: "More than 24 hours since the customer’s last message. They need to write first." };

  const config = readMetaConfig();
  const connection = conversation.connection_id
    ? await getConnection<MetaCredentials>(admin, tenantId, conversation.connection_id as string)
    : null;
  const token = tokenFor(connection?.credentials ?? null);
  if (!config || !connection || !token)
    return { delivered: false, reason: "This account is disconnected. Reconnect it in Channels." };
  try {
    await sendDirectMessage(
      config,
      conversation.channel as "messenger",
      { externalId: connection.externalId, token, recipient: conversation.external_thread_id as string },
      text,
    );
    return { delivered: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Sending failed.";
    await markConnectionError(admin, tenantId, connection.id, reason);
    return { delivered: false, reason };
  }
}
