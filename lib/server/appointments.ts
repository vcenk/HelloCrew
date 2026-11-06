import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isKnownTimeZone } from "@/lib/calendar/account";
import {
  digestMessage,
  localDateIn,
  localHourIn,
  nextLocalDate,
  onLocalDay,
  reminderMessage,
  shouldSendDigest,
  skipReason,
  REMINDER_LEAD_HOURS,
  type Appointment,
} from "@/lib/reminders";
import { ownerAlertAddress, sendEmail } from "./notify";

/**
 * The record of what HelloCrew booked, and the reminders that run off it.
 *
 * Writes go through the service role: an appointment is created when an
 * owner approves a booking, never by a browser, so the table has no insert
 * policy for authenticated at all.
 */

type Row = {
  id: string;
  tenant_id: string;
  service: string;
  starts_at: string;
  says: string | null;
  customer_name: string | null;
  customer_email: string | null;
  status: "booked" | "cancelled";
  reminder_sent_at: string | null;
};

function toAppointment(row: Row): Appointment {
  return {
    id: row.id,
    service: row.service,
    startsAt: new Date(row.starts_at),
    says: row.says,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    status: row.status,
    reminderSentAt: row.reminder_sent_at ? new Date(row.reminder_sent_at) : null,
  };
}

const SELECT =
  "id, tenant_id, service, starts_at, says, customer_name, customer_email, status, reminder_sent_at";

export type RecordedBooking = {
  conversationId: string | null;
  contactId?: string | null;
  service: string;
  start: Date;
  end: Date;
  says?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  idempotencyKey: string;
  externalEventId?: string | null;
};

/**
 * Writes down an appointment the calendar has already accepted.
 *
 * Called after the write, never before: a row here means the booking
 * exists. Upserted on the same key the calendar event carries, so a
 * replayed approval updates one row rather than adding a second.
 *
 * Best effort by design. The customer has already been told they are
 * booked and the calendar already says so; failing the whole approval
 * because a bookkeeping row did not save would be the worse outcome.
 */
export async function recordAppointment(
  admin: SupabaseClient,
  tenantId: string,
  booking: RecordedBooking,
): Promise<boolean> {
  try {
    const { error } = await admin.from("hc_appointments").upsert(
      {
        tenant_id: tenantId,
        conversation_id: booking.conversationId,
        contact_id: booking.contactId ?? null,
        service: booking.service.slice(0, 200),
        starts_at: booking.start.toISOString(),
        ends_at: booking.end.toISOString(),
        says: booking.says?.slice(0, 200) ?? null,
        customer_name: booking.customerName?.slice(0, 120) ?? null,
        customer_email: booking.customerEmail ?? null,
        idempotency_key: booking.idempotencyKey,
        external_event_id: booking.externalEventId ?? null,
        status: "booked",
      },
      { onConflict: "tenant_id,idempotency_key" },
    );
    if (error) throw new Error(error.message);
    return true;
  } catch (error) {
    console.error(
      "[appointments] could not record a booking:",
      error instanceof Error ? error.message : "unknown",
    );
    return false;
  }
}

/** Marks one cancelled, so no reminder goes out for it. */
export async function markAppointmentCancelled(
  admin: SupabaseClient,
  tenantId: string,
  idempotencyKey: string,
): Promise<boolean> {
  try {
    const { error } = await admin
      .from("hc_appointments")
      .update({ status: "cancelled" })
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", idempotencyKey);
    if (error) throw new Error(error.message);
    return true;
  } catch (error) {
    console.error(
      "[appointments] could not cancel:",
      error instanceof Error ? error.message : "unknown",
    );
    return false;
  }
}

export type ReminderRun = {
  considered: number;
  sent: number;
  skipped: Record<string, number>;
};

/**
 * Sends the reminders that are due, across every workspace.
 *
 * `reminder_sent_at` is written only after the provider accepted the
 * message, and a failure leaves it null so the next run tries again. The
 * window has a floor, so "tries again" cannot mean a reminder arriving
 * after the appointment.
 */
export async function sendDueReminders(
  admin: SupabaseClient,
  now = new Date(),
): Promise<ReminderRun> {
  const run: ReminderRun = { considered: 0, sent: 0, skipped: {} };
  const horizon = new Date(now.getTime() + REMINDER_LEAD_HOURS * 3_600_000);

  const { data, error } = await admin
    .from("hc_appointments")
    .select(SELECT)
    .eq("status", "booked")
    .is("reminder_sent_at", null)
    .gte("starts_at", now.toISOString())
    .lte("starts_at", horizon.toISOString())
    .order("starts_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Row[];
  run.considered = rows.length;
  // One name lookup per workspace rather than per appointment.
  const names = new Map<string, string>();

  for (const row of rows) {
    const appointment = toAppointment(row);
    const skip = skipReason(appointment, now);
    if (skip) {
      run.skipped[skip] = (run.skipped[skip] ?? 0) + 1;
      continue;
    }
    if (!(await remindersWanted(admin, row.tenant_id))) {
      run.skipped.turned_off = (run.skipped.turned_off ?? 0) + 1;
      continue;
    }

    let business = names.get(row.tenant_id);
    if (business === undefined) {
      business = await businessName(admin, row.tenant_id);
      names.set(row.tenant_id, business);
    }

    const message = reminderMessage(appointment, business);
    const accepted = await sendEmail({
      to: appointment.customerEmail!,
      subject: message.subject,
      text: message.text,
    });
    if (!accepted) {
      // Left unmarked on purpose: the next run retries while the
      // appointment is still far enough away to be worth reminding about.
      run.skipped.send_failed = (run.skipped.send_failed ?? 0) + 1;
      continue;
    }
    const { error: markError } = await admin
      .from("hc_appointments")
      // Scoped by tenant as well as id: the table is keyed (tenant_id, id),
      // and every other write here names both.
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("tenant_id", row.tenant_id)
      .eq("id", row.id);
    if (markError)
      console.error("[appointments] sent but could not mark:", markError.message);
    run.sent += 1;
  }

  return run;
}

/**
 * Tomorrow's appointments for one workspace, on the business's own clock.
 *
 * "Tomorrow" is the next local calendar date, not now plus 24 hours. The
 * rolling window this used to use meant a digest sent at six in the
 * evening covered 6pm tomorrow to 6pm the day after — half of two days,
 * and not the day the email says it is describing.
 *
 * The database is asked for a generous span of instants and the local day
 * is picked out in code, so no offset arithmetic is needed and a daylight
 * saving change cannot move the boundary.
 */
export async function appointmentsTomorrow(
  admin: SupabaseClient,
  tenantId: string,
  timeZone: string,
  now = new Date(),
): Promise<Appointment[]> {
  const tomorrow = nextLocalDate(localDateIn(now, timeZone));
  // Wide enough to contain the whole of any zone's "tomorrow" — the
  // extremes are only ±14 hours from UTC — and still bounded.
  const end = new Date(now.getTime() + 72 * 3_600_000);
  const { data } = await admin
    .from("hc_appointments")
    .select(SELECT)
    .eq("tenant_id", tenantId)
    .eq("status", "booked")
    .gte("starts_at", now.toISOString())
    .lt("starts_at", end.toISOString())
    .order("starts_at", { ascending: true })
    .limit(200);

  return onLocalDay(
    ((data ?? []) as Row[]).map(toAppointment),
    tomorrow,
    timeZone,
  );
}

export type DigestRun = {
  workspaces: number;
  sent: number;
  skipped: Record<string, number>;
};

/**
 * Emails each owner tomorrow's appointments, once, the evening before.
 *
 * Driven from the appointments rather than from the list of workspaces: a
 * business with nothing booked has nothing to be told, and walking every
 * tenant every hour to discover that would be most of the work for none of
 * the value.
 *
 * `last_digest_on` is written only after the provider accepts, so a failed
 * send is retried on the next run inside the window rather than lost for
 * the day.
 */
export async function sendOwnerDigests(
  admin: SupabaseClient,
  now = new Date(),
): Promise<DigestRun> {
  const run: DigestRun = { workspaces: 0, sent: 0, skipped: {} };
  const skip = (reason: string) => {
    run.skipped[reason] = (run.skipped[reason] ?? 0) + 1;
  };

  const horizon = new Date(now.getTime() + 72 * 3_600_000);
  const { data, error } = await admin
    .from("hc_appointments")
    .select("tenant_id")
    .eq("status", "booked")
    .gte("starts_at", now.toISOString())
    .lt("starts_at", horizon.toISOString())
    .limit(1000);
  if (error) throw new Error(error.message);

  const tenants = [...new Set(((data ?? []) as { tenant_id: string }[]).map((row) => row.tenant_id))];
  run.workspaces = tenants.length;

  for (const tenantId of tenants) {
    const settings = await digestSettings(admin, tenantId);
    if (!settings.wanted) {
      skip("turned_off");
      continue;
    }

    const timeZone = await tenantTimeZone(admin, tenantId);
    const today = localDateIn(now, timeZone);
    if (!shouldSendDigest(localHourIn(now, timeZone), settings.lastSentOn, today)) {
      skip(settings.lastSentOn === today ? "already_sent" : "not_the_hour");
      continue;
    }

    const appointments = await appointmentsTomorrow(admin, tenantId, timeZone, now);
    const message = digestMessage(appointments, await businessName(admin, tenantId));
    // Nothing booked tomorrow. Deliberately not marked as sent, so a
    // booking made later this evening still earns a digest tonight.
    if (!message) {
      skip("nothing_tomorrow");
      continue;
    }

    const to = await ownerAlertAddress(admin, tenantId);
    if (!to) {
      skip("no_address");
      continue;
    }

    const accepted = await sendEmail({
      to,
      subject: message.subject,
      text: `${message.text}\n\nYou can turn this off in HelloCrew → Settings.`,
    });
    if (!accepted) {
      skip("send_failed");
      continue;
    }

    const { error: markError } = await admin
      .from("hc_notification_settings")
      .update({ last_digest_on: today })
      .eq("tenant_id", tenantId);
    if (markError)
      console.error("[appointments] digest sent but could not mark:", markError.message);
    run.sent += 1;
  }

  return run;
}

export { digestMessage };

/** Whether this owner wants a digest, and when they last got one. */
async function digestSettings(admin: SupabaseClient, tenantId: string) {
  const { data } = await admin
    .from("hc_notification_settings")
    .select("on_digest, last_digest_on")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const row = data as { on_digest?: boolean; last_digest_on?: string | null } | null;
  return {
    // Default on, matching the column default, so a workspace that never
    // opened the settings behaves the way the schema describes.
    wanted: row?.on_digest !== false,
    lastSentOn: row?.last_digest_on ?? null,
  };
}

/**
 * The business's own timezone, from its connected calendar.
 *
 * UTC when there is no calendar — which also means there are no
 * appointments, since bookings only exist through one.
 */
async function tenantTimeZone(admin: SupabaseClient, tenantId: string) {
  const { data } = await admin
    .from("hc_channel_connections")
    .select("settings")
    .eq("tenant_id", tenantId)
    .eq("kind", "google_calendar")
    .eq("status", "connected")
    .maybeSingle();
  const zone = (data as { settings?: { timeZone?: string } } | null)?.settings
    ?.timeZone;
  return zone && isKnownTimeZone(zone) ? zone : "UTC";
}

async function remindersWanted(admin: SupabaseClient, tenantId: string) {
  const { data } = await admin
    .from("hc_notification_settings")
    .select("on_reminder")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  // Default on: a workspace that never opened the settings still gets the
  // behaviour the column's default describes.
  return (data as { on_reminder?: boolean } | null)?.on_reminder !== false;
}

async function businessName(admin: SupabaseClient, tenantId: string) {
  const { data } = await admin
    .from("hc_tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();
  return ((data as { name?: string } | null)?.name ?? "").trim() || "us";
}
