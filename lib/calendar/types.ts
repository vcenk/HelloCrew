/**
 * The calendar HelloCrew talks to, whatever the business actually runs on.
 *
 * HelloCrew is not a booking platform. A salon keeps Fresha, Vagaro, Square or
 * a plain Google Calendar; this is the seam those plug into. Adapters are
 * deliberately small, because several of these platforms expose read access
 * long before they expose write access:
 *
 *   - readBusy is the only method an adapter must implement.
 *   - createEvent is optional. Without it the crew still proposes a time and
 *     the owner books it in their own system after approving.
 */

/** An absolute, instant-based interval. Never a wall-clock time. */
export type Interval = { start: Date; end: Date };

/** Minutes from local midnight, in the business's own timezone. */
export type MinuteOfDay = number;

/** 0 = Sunday, matching Date.prototype.getDay. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * When the business actually takes appointments.
 *
 * This is deliberately separate from BusinessProfile.hours, which is free text
 * for telling customers ("Monday–Friday, 9am–5pm"). Parsing that into slots
 * would mean guessing, and a guessed opening time becomes a real appointment
 * someone has to honour.
 */
export type OpeningHours = Partial<
  Record<Weekday, { opens: MinuteOfDay; closes: MinuteOfDay }[]>
>;

export type CalendarProviderId =
  | "google_calendar"
  | "square_appointments"
  | "vagaro"
  | "ical";

export type CalendarAccount = {
  provider: CalendarProviderId;
  /** The calendar within the account, as that provider names it. */
  calendarId: string;
  /** IANA zone the business works in, e.g. "Europe/Istanbul". */
  timeZone: string;
  openingHours: OpeningHours;
  /** Minimum appointment length the business will take. */
  defaultDurationMinutes: number;
  /** How soon from now a proposal is allowed to be. */
  leadTimeMinutes: number;
};

export type CreatedEvent = {
  /** The provider's own id, so a repeat can be recognised. */
  externalId: string;
  start: Date;
  end: Date;
  /** Where the owner can see it. */
  url?: string;
};

export type CalendarAdapter = {
  provider: CalendarProviderId;

  /** Intervals already taken, for the window asked about. */
  readBusy(account: CalendarAccount, window: Interval): Promise<Interval[]>;

  /**
   * Writes an appointment. Optional on purpose: Fresha publishes no booking
   * API and Booksy's is partnership-only, so for those the owner books in
   * their own system after approving. An adapter without this still supports
   * the whole propose-and-approve flow.
   */
  createEvent?(
    account: CalendarAccount,
    event: {
      start: Date;
      end: Date;
      title: string;
      notes?: string;
      /**
       * Stable across retries and approval replays. An adapter must either
       * pass it to the provider's own idempotency mechanism or check for an
       * existing event carrying it before writing a second one.
       */
      idempotencyKey: string;
    },
  ): Promise<CreatedEvent>;
};

/** True when the business can have HelloCrew write the appointment itself. */
export function canWrite(adapter: CalendarAdapter): boolean {
  return typeof adapter.createEvent === "function";
}
