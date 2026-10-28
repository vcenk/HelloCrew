"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";

import {
  getCalendarSetup,
  updateCalendarSettings,
  type CalendarSetup,
} from "@/app/app/calendar-actions";
import type { CalendarSettings } from "@/lib/calendar/account";
import { useDashboard } from "./provider";
import { Button } from "./ui";
import { useUnsavedChanges } from "./unsaved-changes";

const DAYS: { key: string; label: string }[] = [
  { key: "1", label: "Monday" },
  { key: "2", label: "Tuesday" },
  { key: "3", label: "Wednesday" },
  { key: "4", label: "Thursday" },
  { key: "5", label: "Friday" },
  { key: "6", label: "Saturday" },
  { key: "0", label: "Sunday" },
];

/** "09:00" from minutes since midnight, and back. */
const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
};

/** Zones offered by name, with whatever the calendar already uses included. */
function timeZoneOptions(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [current];
  return supported.includes(current) ? supported : [current, ...supported];
}

/** The zone this browser is in, when it can be read. */
function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * "Europe/Istanbul (GMT+3)" rather than "Europe/Istanbul".
 *
 * Four hundred identifiers with no offsets is a list to get lost in, and
 * picking the wrong one is not obvious until a customer turns up at the
 * wrong hour. The offset is the part an owner can actually recognise.
 */
function zoneLabel(zone: string): string {
  const name = zone.replace(/_/g, " ");
  try {
    const offset = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    return offset ? `${name} (${offset})` : name;
  } catch {
    return name;
  }
}

export function CalendarHours() {
  const { toast } = useDashboard();
  const [setup, setSetup] = useState<CalendarSetup | null>(null);
  const [draft, setDraft] = useState<CalendarSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const dirty =
    draft !== null &&
    setup !== null &&
    JSON.stringify(draft) !== JSON.stringify(setup.settings);
  useUnsavedChanges("calendar-hours", dirty);

  useEffect(() => {
    let cancelled = false;
    void getCalendarSetup().then((result) => {
      if (cancelled) return;
      if (result.ok && result.setup) {
        setSetup(result.setup);
        setDraft(result.setup.settings);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="today-note">Loading your working hours…</p>;
  if (!setup || !draft)
    return (
      <p className="today-note">
        Connect a calendar first, then set the hours the crew may offer.
      </p>
    );

  // The saved zone, and the one this browser is in. Deduped and in that
  // order, so the current setting is always the first thing in the list.
  const suggestedZones = [
    ...new Set([draft.timeZone, deviceTimeZone()].filter(Boolean) as string[]),
  ];

  const blockFor = (day: string) => draft.openingHours[day]?.[0];

  const setDay = (day: string, open: boolean) =>
    setDraft({
      ...draft,
      openingHours: {
        ...draft.openingHours,
        [day]: open ? [{ opens: 540, closes: 1020 }] : [],
      },
    });

  const setEdge = (day: string, edge: "opens" | "closes", value: string) => {
    const block = blockFor(day) ?? { opens: 540, closes: 1020 };
    setDraft({
      ...draft,
      openingHours: {
        ...draft.openingHours,
        [day]: [{ ...block, [edge]: toMinutes(value) }],
      },
    });
  };

  // Caught here as well as on the server, so the owner sees it immediately.
  const backwards = DAYS.filter((day) => {
    const block = blockFor(day.key);
    return block && block.closes <= block.opens;
  });

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    const result = await updateCalendarSettings(draft).catch(() => null);
    setSaving(false);
    if (!result?.ok) {
      toast(result?.error ?? "Couldn’t save those working hours.", "error");
      return;
    }
    setSetup((current) =>
      current
        ? {
            ...current,
            settings: result.settings,
            needsAttention: false,
            // Saving is the confirmation, so the warning goes now rather
            // than on the next load.
            reviewed: true,
          }
        : current,
    );
    setDraft(result.settings);
    toast(dirty ? "Working hours saved" : "Working hours confirmed");
  }

  return (
    <div className="calendar-hours">
      {setup.needsAttention && (
        <p className="form-error" role="alert">
          <AlertTriangle size={14} aria-hidden="true" /> These hours couldn’t be
          read, so the crew isn’t offering any times. Check them and save.
        </p>
      )}

      <p className="today-note">
        Times the crew may offer from <strong>{setup.calendarName}</strong>.
        Anything already in the calendar is treated as busy, and every booking
        still waits for your approval.
      </p>

      <div className="field">
        <label htmlFor="cal-tz">Timezone</label>
        <select
          id="cal-tz"
          value={draft.timeZone}
          aria-describedby={setup.reviewed ? undefined : "cal-tz-note"}
          onChange={(event) =>
            setDraft({ ...draft, timeZone: event.target.value })
          }
        >
          {/* The two an owner is most likely to want, out of four hundred. */}
          <optgroup label="Likely">
            {suggestedZones.map((zone) => (
              <option key={`suggested-${zone}`} value={zone}>
                {zoneLabel(zone)}
              </option>
            ))}
          </optgroup>
          <optgroup label="All timezones">
            {timeZoneOptions(draft.timeZone).map((zone) => (
              <option key={zone} value={zone}>
                {zoneLabel(zone)}
              </option>
            ))}
          </optgroup>
        </select>
        {!setup.reviewed && (
          <p className="today-note" id="cal-tz-note">
            Taken from <strong>{setup.calendarName}</strong> when you connected
            it — nobody has checked it against your business yet. Customers are
            offered times in this zone, so make sure it is the right one, then
            save.
          </p>
        )}
      </div>

      <ul className="hours-list" aria-label="Working hours">
        {DAYS.map((day) => {
          const block = blockFor(day.key);
          return (
            <li key={day.key} className="hours-row">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={Boolean(block)}
                  onChange={(event) => setDay(day.key, event.target.checked)}
                />
                <span aria-hidden="true" />
                {day.label}
              </label>
              {block ? (
                <span className="hours-times">
                  <input
                    type="time"
                    aria-label={`${day.label} opens`}
                    value={toTime(block.opens)}
                    onChange={(event) =>
                      setEdge(day.key, "opens", event.target.value)
                    }
                  />
                  <span aria-hidden="true">to</span>
                  <input
                    type="time"
                    aria-label={`${day.label} closes`}
                    value={toTime(block.closes)}
                    onChange={(event) =>
                      setEdge(day.key, "closes", event.target.value)
                    }
                  />
                </span>
              ) : (
                <span className="hours-closed">Closed</span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="field-row">
        <div className="field">
          <label htmlFor="cal-duration">Appointment length</label>
          <select
            id="cal-duration"
            value={draft.defaultDurationMinutes}
            onChange={(event) =>
              setDraft({
                ...draft,
                defaultDurationMinutes: Number(event.target.value),
              })
            }
          >
            {[15, 30, 45, 60, 90, 120].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cal-lead">Shortest notice</label>
          <select
            id="cal-lead"
            value={draft.leadTimeMinutes}
            onChange={(event) =>
              setDraft({ ...draft, leadTimeMinutes: Number(event.target.value) })
            }
          >
            {[
              { value: 0, label: "Any time" },
              { value: 60, label: "1 hour" },
              { value: 120, label: "2 hours" },
              { value: 240, label: "4 hours" },
              { value: 1440, label: "1 day" },
            ].map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {backwards.length > 0 && (
        <p className="form-error" role="alert">
          {backwards[0].label} closes before it opens.
        </p>
      )}

      {/*
        Confirming is a save even when nothing was edited: an owner whose
        calendar already had the right timezone agrees with every field, and
        would otherwise have no way to say so — leaving the warning above
        permanently on screen for settings that were correct all along.
      */}
      <Button
        variant="primary"
        icon={Check}
        disabled={(!dirty && setup.reviewed) || saving || backwards.length > 0}
        onClick={() => void save()}
      >
        {saving
          ? "Saving…"
          : dirty
            ? "Save working hours"
            : setup.reviewed
              ? "Save working hours"
              : "These are right — confirm"}
      </Button>
    </div>
  );
}
