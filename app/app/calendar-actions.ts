"use server";

import { z } from "zod";

import {
  CalendarSettingsError,
  DEFAULT_CALENDAR_SETTINGS,
  isKnownTimeZone,
  parseCalendarSettings,
  type CalendarSettings,
} from "@/lib/calendar/account";
import { getWorkspaceContext } from "@/lib/data/workspace";
import { listConnectionsFor } from "@/lib/server/connections";
import { widgetAdminClient } from "@/lib/server/widget-installations";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

type Failure = { ok: false; error: string };

async function session(write: boolean) {
  if (!isSupabaseConfigured()) return null;
  const db = await createClient();
  const workspace = await getWorkspaceContext(db);
  if (!workspace || (write && workspace.role === "viewer")) return null;
  const admin = widgetAdminClient();
  if (!admin) return null;
  return { admin, workspace };
}

export type CalendarSetup = {
  connectionId: string;
  calendarName: string;
  settings: CalendarSettings;
  /** True when the stored settings could not be read and defaults are shown. */
  needsAttention: boolean;
};

/** The connected calendar and the hours the crew may offer, for the editor. */
export async function getCalendarSetup(): Promise<
  { ok: true; setup: CalendarSetup | null } | Failure
> {
  const s = await session(false);
  if (!s) return { ok: false, error: "Sign in to manage your calendar." };

  const connections = await listConnectionsFor(
    s.admin,
    s.workspace.tenantId,
    "google_calendar",
  ).catch(() => []);
  const connection = connections.find((c) => c.status === "connected");
  if (!connection) return { ok: true, setup: null };

  // Unreadable settings are shown as the defaults with a warning rather than
  // hidden: the owner needs to see that the crew is not offering times.
  try {
    return {
      ok: true,
      setup: {
        connectionId: connection.id,
        calendarName: connection.displayName,
        settings: parseCalendarSettings(connection.settings),
        needsAttention: false,
      },
    };
  } catch {
    return {
      ok: true,
      setup: {
        connectionId: connection.id,
        calendarName: connection.displayName,
        settings: DEFAULT_CALENDAR_SETTINGS,
        needsAttention: true,
      },
    };
  }
}

const blockSchema = z
  .object({
    opens: z.number().int().min(0).max(1440),
    closes: z.number().int().min(0).max(1440),
  })
  .refine((block) => block.closes > block.opens, {
    message: "A closing time must be after its opening time.",
  });

const inputSchema = z.object({
  timeZone: z.string().trim().min(1).max(64),
  // Keys are weekdays, 0 = Sunday. At most two blocks a day covers a lunch
  // break without turning this into a rota editor.
  openingHours: z.record(z.string(), z.array(blockSchema).max(2)),
  defaultDurationMinutes: z.number().int().min(5).max(480),
  leadTimeMinutes: z.number().int().min(0).max(10_080),
});

/** Saves the hours the crew may offer. Never touches credentials. */
export async function updateCalendarSettings(
  input: unknown,
): Promise<{ ok: true; settings: CalendarSettings } | Failure> {
  const s = await session(true);
  if (!s)
    return { ok: false, error: "Only owners and operators can change this." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ??
        "Those working hours couldn’t be saved.",
    };

  if (!isKnownTimeZone(parsed.data.timeZone))
    return { ok: false, error: "That timezone isn’t one we recognise." };

  // Runs the same validation the agent uses, so the editor cannot save
  // something the crew would then refuse to read.
  let settings: CalendarSettings;
  try {
    settings = parseCalendarSettings(parsed.data);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof CalendarSettingsError
          ? error.message
          : "Those working hours couldn’t be saved.",
    };
  }

  const connections = await listConnectionsFor(
    s.admin,
    s.workspace.tenantId,
    "google_calendar",
  ).catch(() => []);
  const connection = connections.find((c) => c.status === "connected");
  if (!connection)
    return { ok: false, error: "No calendar is connected yet." };

  const { error } = await s.admin
    .from("hc_channel_connections")
    .update({ settings })
    .eq("tenant_id", s.workspace.tenantId)
    .eq("id", connection.id);
  if (error) return { ok: false, error: "Couldn’t save those working hours." };

  return { ok: true, settings };
}
