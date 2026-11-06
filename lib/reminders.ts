import { localWallClock } from "@/lib/calendar/slots";

/**
 * When a reminder goes out, and what it says.
 *
 * Pure, so the rules that decide whether a real customer is emailed can be
 * tested without a database or a mail provider. Everything that touches
 * either lives in lib/server/appointments.ts.
 */

export type Appointment = {
  id: string;
  service: string;
  startsAt: Date;
  says: string | null;
  customerName: string | null;
  customerEmail: string | null;
  status: "booked" | "cancelled";
  reminderSentAt: Date | null;
};

/** How far ahead of the appointment a reminder is aimed. */
export const REMINDER_LEAD_HOURS = 24;

/**
 * How late a reminder may still be useful.
 *
 * The cron runs hourly and can miss a run — a deploy, an outage, a cold
 * start. Without a floor, a missed run means the reminder is silently
 * dropped; with one, the next run catches it. Below the floor it is not
 * sent at all: "your appointment is in twenty minutes" arriving as the
 * customer walks in is worse than nothing.
 */
export const REMINDER_FLOOR_HOURS = 2;

export type Skip =
  | "cancelled"
  | "already_reminded"
  | "no_email"
  | "too_early"
  | "too_late";

/** Why this appointment is not being reminded about, or null to send. */
export function skipReason(
  appointment: Appointment,
  now: Date,
): Skip | null {
  if (appointment.status !== "booked") return "cancelled";
  if (appointment.reminderSentAt) return "already_reminded";
  // Nowhere to send it. The agent never asks a website visitor for an
  // address, so this is the common case rather than an edge one.
  if (!appointment.customerEmail) return "no_email";

  const hoursAway =
    (appointment.startsAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursAway > REMINDER_LEAD_HOURS) return "too_early";
  if (hoursAway < REMINDER_FLOOR_HOURS) return "too_late";
  return null;
}

export function dueForReminder(
  appointments: readonly Appointment[],
  now: Date,
): Appointment[] {
  return appointments.filter(
    (appointment) => skipReason(appointment, now) === null,
  );
}

/** The reminder itself. Only facts already agreed with the customer. */
export function reminderMessage(
  appointment: Appointment,
  businessName: string,
): { subject: string; text: string } {
  const when = appointment.says ?? appointment.startsAt.toISOString();
  const greeting = appointment.customerName
    ? `Hi ${appointment.customerName},`
    : "Hi,";
  return {
    subject: `Reminder: ${appointment.service} at ${businessName}`,
    text: [
      greeting,
      "",
      `This is a reminder about your ${appointment.service} at ${businessName}, ${when}.`,
      "",
      "If you need to change or cancel it, just reply to the chat where you booked and we'll sort it out.",
    ].join("\n"),
  };
}

/** The local hour the owner's digest aims for, the evening before. */
export const DIGEST_HOUR = 18;

/**
 * The last local hour it is still worth sending one.
 *
 * Same reasoning as the reminder floor: the cron can miss a run, and a
 * digest that is simply dropped for the day is worse than one arriving at
 * nine in the evening. Past this it waits for tomorrow, because "tomorrow"
 * stops meaning what the owner reads it as.
 */
export const DIGEST_LAST_HOUR = 22;

/**
 * The calendar date an instant falls on, where the business is.
 *
 * Asks the timezone rather than computing an offset, the same way
 * localWallClock does, so daylight saving is a non-event. en-CA because it
 * renders dates as YYYY-MM-DD, which sorts and compares as a string.
 */
export function localDateIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The hour on the business's own clock, 0–23. */
export function localHourIn(instant: Date, timeZone: string): number {
  return Math.floor(localWallClock(instant, timeZone).minuteOfDay / 60);
}

/**
 * The day after a YYYY-MM-DD date.
 *
 * Plain calendar arithmetic with no timezone in it: the date has already
 * been resolved in the business's zone, and "the next date" is the same
 * question in every zone. Done in UTC space so no local offset can shift it.
 */
export function nextLocalDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * Whether this run should send the owner their digest.
 *
 * `lastSentOn` and `today` are both local dates, so one digest a day means
 * one per day where the business is, not per UTC day.
 */
export function shouldSendDigest(
  localHour: number,
  lastSentOn: string | null,
  today: string,
): boolean {
  if (lastSentOn === today) return false;
  return localHour >= DIGEST_HOUR && localHour < DIGEST_LAST_HOUR;
}

/** The appointments falling on one local date, out of a wider window. */
export function onLocalDay(
  appointments: readonly Appointment[],
  localDate: string,
  timeZone: string,
): Appointment[] {
  return appointments.filter(
    (appointment) => localDateIn(appointment.startsAt, timeZone) === localDate,
  );
}

/** The owner's view of tomorrow, for the daily digest. */
export function digestMessage(
  appointments: readonly Appointment[],
  businessName: string,
): { subject: string; text: string } | null {
  const booked = appointments.filter(
    (appointment) => appointment.status === "booked",
  );
  // No appointments is not news. An empty digest every morning is how an
  // owner learns to filter the address.
  if (booked.length === 0) return null;

  const lines = [...booked]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map((appointment) => {
      const who = appointment.customerName ?? "someone";
      const when = appointment.says ?? appointment.startsAt.toISOString();
      return `- ${when} — ${appointment.service} with ${who}`;
    });

  return {
    subject: `${booked.length} appointment${booked.length === 1 ? "" : "s"} tomorrow at ${businessName}`,
    text: [`Tomorrow at ${businessName}:`, "", ...lines].join("\n"),
  };
}
