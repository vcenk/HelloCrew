import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { IntegrationId, ToolContract } from "@/lib/agent/tool-contract";
import { listConnectionsFor } from "@/lib/server/connections";
import type { GoogleCredentials } from "@/lib/server/google";
import { calendarFromConnection, CalendarSettingsError } from "./account";
import {
  calendarApprovalAction,
  calendarProposalFromApproval,
} from "./approval";
import {
  calendarContracts,
  type BookingProposal,
  type CalendarTurnEffects,
} from "./tools";
import type { CalendarAccount, CalendarAdapter } from "./types";

/**
 * The calendar tools for one workspace's turn, if it has a calendar connected
 * and configured.
 *
 * A workspace with no calendar gets no calendar tools and no mention of them,
 * rather than tools that fail when called. A misconfigured one is treated the
 * same way and logged: offering times from working hours we could not read is
 * worse than not offering times.
 */
export async function calendarForTurn(
  admin: SupabaseClient,
  tenantId: string,
  conversationId: string,
  effects: CalendarTurnEffects,
): Promise<{
  contracts: ToolContract[];
  connected: Set<IntegrationId>;
}> {
  const calendar = await calendarForTenant(admin, tenantId);
  if (!calendar) return { contracts: [], connected: new Set<IntegrationId>() };

  effects.booked = await bookingsFor(admin, tenantId, conversationId);

  return {
    contracts: calendarContracts({ ...calendar, effects }),
    connected: new Set<IntegrationId>(["google_calendar"]),
  };
}

/**
 * The workspace's calendar, or null when there is none to use.
 *
 * Shared by the agent's turn and by the owner's approval, so the booking is
 * written against exactly the calendar and working hours the time was offered
 * from — rather than two paths that could drift apart.
 */
export async function calendarForTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ account: CalendarAccount; adapter: CalendarAdapter } | null> {
  const connections = await listConnectionsFor<GoogleCredentials>(
    admin,
    tenantId,
    "google_calendar",
  ).catch(() => []);

  const usable = connections.find(
    (connection) => connection.status === "connected",
  );
  if (!usable) return null;

  try {
    return calendarFromConnection(usable);
  } catch (error) {
    if (error instanceof CalendarSettingsError)
      console.warn(
        `[calendar] tenant ${tenantId} has a calendar connected but unusable:`,
        error.message,
      );
    return null;
  }
}

/**
 * The appointments this conversation actually booked and still has.
 *
 * Read from our own approvals rather than searched for in the calendar: the
 * crew must never cancel something because the name looked close enough.
 * Past appointments and ones already being cancelled are left out, so the
 * list the model sees only contains things it can really act on.
 */
async function bookingsFor(
  admin: SupabaseClient,
  tenantId: string,
  conversationId: string,
  now = new Date(),
): Promise<BookingProposal[]> {
  const { data } = await admin
    .from("hc_approvals")
    .select("id, status, details")
    .eq("tenant_id", tenantId)
    .eq("conversation_id", conversationId)
    .in("status", ["approved", "pending"])
    .order("created_at", { ascending: true });

  const rows = data ?? [];
  const cancelling = new Set(
    rows
      .filter((row) => calendarApprovalAction(row.details) === "cancel")
      .map((row) => calendarProposalFromApproval(String(row.id), row.details))
      .filter((proposal): proposal is BookingProposal => proposal !== null)
      .map((proposal) => proposal.idempotencyKey),
  );

  return rows
    .filter(
      (row) =>
        row.status === "approved" &&
        calendarApprovalAction(row.details) === "book",
    )
    .map((row) => calendarProposalFromApproval(String(row.id), row.details))
    .filter((proposal): proposal is BookingProposal => proposal !== null)
    .filter(
      (proposal) =>
        proposal.start.getTime() > now.getTime() &&
        !cancelling.has(proposal.idempotencyKey),
    );
}
