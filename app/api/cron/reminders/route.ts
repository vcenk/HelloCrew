import { timingSafeEqual } from "node:crypto";

import { sendDueReminders } from "@/lib/server/appointments";
import { emailConfigured } from "@/lib/server/notify";
import { widgetAdminClient } from "@/lib/server/widget-installations";

export const runtime = "nodejs";
export const maxDuration = 300;

// Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET".
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return (
    Boolean(secret) &&
    header.length === expected.length &&
    timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  );
}

/**
 * Reminds customers about appointments coming up.
 *
 * Hourly rather than daily: the window has a floor as well as a lead time,
 * so a run that is missed is picked up by the next one instead of dropping
 * the reminder silently. Sending twice is prevented by the row itself,
 * which is marked only once the provider has accepted the message.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  const admin = widgetAdminClient();
  if (!admin) return Response.json({ sent: 0, reason: "not_configured" });
  // Without a mail provider every send would fail and every appointment
  // would be retried next hour for nothing.
  if (!emailConfigured()) return Response.json({ sent: 0, reason: "no_email_provider" });

  try {
    const run = await sendDueReminders(admin);
    return Response.json(run);
  } catch (error) {
    console.error(
      "[cron/reminders] failed:",
      error instanceof Error ? error.message : "unknown",
    );
    return Response.json({ sent: 0, reason: "error" }, { status: 500 });
  }
}
