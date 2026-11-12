import "server-only";

import type { CopilotAuditEvent } from "./audit";

/**
 * Turning stored audit rows into what the owner is shown.
 *
 * Separate from the server action because a `"use server"` module may only
 * export async functions, and because the interesting parts — what the page
 * is allowed to carry, and how a caller-supplied page size is bounded —
 * should be testable without a request, a session or a database.
 */

/**
 * One line of history, as it reaches the browser.
 *
 * Deliberately not the stored row. The actor's user id stays on the server:
 * the owner needs to know whether an action was theirs, not to receive a uuid
 * in the page. Everything here is a count, a code or a bounded label, which
 * is the same promise the table makes.
 */
export type ActivityEntry = {
  event: string;
  action: string;
  resource: string;
  safety: string;
  outcome: CopilotAuditEvent["outcome"];
  applied?: number;
  skipped?: number;
  reason?: string;
  at: string;
  /** Whether the signed-in viewer is the person who did this. */
  byYou: boolean;
  /** The role held at the time, or null when the system acted. */
  role: string | null;
};

export const DEFAULT_PAGE = 25;
export const MAX_PAGE = 100;

/**
 * A page size that is safe to pass on.
 *
 * A server action's arguments arrive from the browser, so anything can be
 * sent: a string, a float, a negative, a million. Bounded here as well as in
 * `recentAuditEvents`, because one of the two will outlive the other.
 */
export function pageSize(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_PAGE;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_PAGE);
}

export function toActivityEntries(
  events: CopilotAuditEvent[],
  viewerUserId: string,
): ActivityEntry[] {
  return events.map((event) => ({
    event: event.event,
    action: event.action,
    resource: event.resource,
    safety: event.safety,
    outcome: event.outcome,
    // Absent stays absent rather than becoming 0, which would read as
    // "applied nothing" instead of "did not report a count".
    ...(event.applied === undefined ? {} : { applied: event.applied }),
    ...(event.skipped === undefined ? {} : { skipped: event.skipped }),
    ...(event.reason === undefined ? {} : { reason: event.reason }),
    at: event.at,
    // An empty actor is the system, which is nobody — never "you", even when
    // the viewer's own id is also somehow empty.
    byYou: Boolean(event.userId) && event.userId === viewerUserId,
    role: event.role || null,
  }));
}
