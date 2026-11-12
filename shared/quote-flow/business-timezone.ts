/**
 * REQ-172 / REQ-255 — the business's IANA time zone. Pure; shared by the
 * backend (the 9 am schedule texts) and Settings (the select's value).
 *
 * The zone is: the one the owner picked (when Intl knows it), else the main
 * zone of the business address's state, else New York. A state that spans
 * two zones takes the one most of its people live in (TX → Chicago,
 * FL → New York, AZ → Phoenix, no DST).
 */
export const DEFAULT_TIMEZONE = "America/New_York";

/** an IANA zone Intl knows, else undefined */
export function validTimezone(tz: unknown): string | undefined {
  if (typeof tz !== "string" || !tz.trim()) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() });
    return tz.trim();
  } catch {
    return undefined;
  }
}

const EAST = "America/New_York";
const CENTRAL = "America/Chicago";
const MOUNTAIN = "America/Denver";
const PACIFIC = "America/Los_Angeles";

/** [code, name, zone] for every state, DC and the territories */
const STATES: ReadonlyArray<readonly [string, string, string]> = [
  ["AL", "Alabama", CENTRAL],
  ["AK", "Alaska", "America/Anchorage"],
  ["AZ", "Arizona", "America/Phoenix"],
  ["AR", "Arkansas", CENTRAL],
  ["CA", "California", PACIFIC],
  ["CO", "Colorado", MOUNTAIN],
  ["CT", "Connecticut", EAST],
  ["DE", "Delaware", EAST],
  ["DC", "District of Columbia", EAST],
  ["FL", "Florida", EAST],
  ["GA", "Georgia", EAST],
  ["HI", "Hawaii", "Pacific/Honolulu"],
  ["ID", "Idaho", "America/Boise"],
  ["IL", "Illinois", CENTRAL],
  ["IN", "Indiana", "America/Indiana/Indianapolis"],
  ["IA", "Iowa", CENTRAL],
  ["KS", "Kansas", CENTRAL],
  ["KY", "Kentucky", EAST],
  ["LA", "Louisiana", CENTRAL],
  ["ME", "Maine", EAST],
  ["MD", "Maryland", EAST],
  ["MA", "Massachusetts", EAST],
  ["MI", "Michigan", "America/Detroit"],
  ["MN", "Minnesota", CENTRAL],
  ["MS", "Mississippi", CENTRAL],
  ["MO", "Missouri", CENTRAL],
  ["MT", "Montana", MOUNTAIN],
  ["NE", "Nebraska", CENTRAL],
  ["NV", "Nevada", PACIFIC],
  ["NH", "New Hampshire", EAST],
  ["NJ", "New Jersey", EAST],
  ["NM", "New Mexico", MOUNTAIN],
  ["NY", "New York", EAST],
  ["NC", "North Carolina", EAST],
  ["ND", "North Dakota", CENTRAL],
  ["OH", "Ohio", EAST],
  ["OK", "Oklahoma", CENTRAL],
  ["OR", "Oregon", PACIFIC],
  ["PA", "Pennsylvania", EAST],
  ["RI", "Rhode Island", EAST],
  ["SC", "South Carolina", EAST],
  ["SD", "South Dakota", CENTRAL],
  ["TN", "Tennessee", CENTRAL],
  ["TX", "Texas", CENTRAL],
  ["UT", "Utah", MOUNTAIN],
  ["VT", "Vermont", EAST],
  ["VA", "Virginia", EAST],
  ["WA", "Washington", PACIFIC],
  ["WV", "West Virginia", EAST],
  ["WI", "Wisconsin", CENTRAL],
  ["WY", "Wyoming", MOUNTAIN],
  ["PR", "Puerto Rico", "America/Puerto_Rico"],
  ["VI", "Virgin Islands", "America/St_Thomas"],
  ["GU", "Guam", "Pacific/Guam"],
  ["AS", "American Samoa", "Pacific/Pago_Pago"],
  ["MP", "Northern Mariana Islands", "Pacific/Saipan"],
];

const BY_KEY = new Map<string, string>(
  STATES.flatMap(([code, name, zone]) => [
    [code.toLowerCase(), zone],
    [name.toLowerCase(), zone],
  ]),
);

/** the main IANA zone of a US state (code or name, any case), else undefined */
export function timezoneForState(state: unknown): string | undefined {
  if (typeof state !== "string") return undefined;
  return BY_KEY.get(state.trim().toLowerCase());
}

/** the zone the business runs on: picked → the address's state → New York */
export function businessTimezone(
  input: { timezone?: unknown; state?: unknown },
): string {
  return validTimezone(input.timezone) ?? timezoneForState(input.state) ??
    DEFAULT_TIMEZONE;
}
