import { timingSafeEqual } from "node:crypto";

import { sendDueReminders, sendOwnerDigests } from "@/lib/server/appointments";
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
 * Reminds customers about appointments coming up, and tells each owner
 * what tomorrow looks like.
 *
 * Hourly rather than daily, and one cron rather than two. Both jobs need
 * the same thing from an hourly beat: the reminder window has a floor as
 * well as a lead time, so a missed run is picked up by the next one
 * instead of dropping the reminder silently; and the digest has to find
 * the owner's own evening, which falls at a different UTC hour for every
 * workspace. Neither can send twice — the appointment row and the
 * settings row are marked only once the provider has accepted.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  const admin = widgetAdminClient();
  if (!admin) return Response.json({ sent: 0, reason: "not_configured" });
  // Without a mail provider every send would fail and every appointment
  // would be retried next hour for nothing.
  if (!emailConfigured()) return Response.json({ sent: 0, reason: "no_email_provider" });

  // Reported separately, and each is allowed to fail on its own: a digest
  // that throws must not stop customers being reminded.
  const result: Record<string, unknown> = {};
  try {
    result.reminders = await sendDueReminders(admin);
  } catch (error) {
    console.error(
      "[cron/reminders] reminders failed:",
      error instanceof Error ? error.message : "unknown",
    );
    result.reminders = { reason: "error" };
  }
  try {
    result.digests = await sendOwnerDigests(admin);
  } catch (error) {
    console.error(
      "[cron/reminders] digests failed:",
      error instanceof Error ? error.message : "unknown",
    );
    result.digests = { reason: "error" };
  }

  const failed =
    (result.reminders as { reason?: string }).reason === "error" &&
    (result.digests as { reason?: string }).reason === "error";
  return Response.json(result, { status: failed ? 500 : 200 });
}
