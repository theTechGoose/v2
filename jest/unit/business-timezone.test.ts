/**
 * REQ-255 (demo issue onboarding-dashboard-settings-m3a) — an Austin, TX
 * business sat on America/New_York: nothing derived the time zone from the
 * state onboarding already collected, so the REQ-172 9 am schedule texts went
 * out at 8 am Central. The zone is now: the one the owner picked, else the
 * business address's state's main zone, else New York.
 * Target: shared/quote-flow/business-timezone.ts + its Settings wiring.
 */
import * as fs from "fs";
import * as path from "path";
import {
  businessTimezone,
  DEFAULT_TIMEZONE,
  timezoneForState,
} from "../../shared/quote-flow/business-timezone";

describe("REQ-255 the business time zone follows the address's state", () => {
  it("REQ-255 maps a state code or name to its main IANA zone", () => {
    expect(timezoneForState("TX")).toBe("America/Chicago");
    expect(timezoneForState(" tx ")).toBe("America/Chicago");
    expect(timezoneForState("Texas")).toBe("America/Chicago");
    expect(timezoneForState("AZ")).toBe("America/Phoenix");
    expect(timezoneForState("CA")).toBe("America/Los_Angeles");
    expect(timezoneForState("CO")).toBe("America/Denver");
    expect(timezoneForState("HI")).toBe("Pacific/Honolulu");
    expect(timezoneForState("AK")).toBe("America/Anchorage");
    expect(timezoneForState("PR")).toBe("America/Puerto_Rico");
    expect(timezoneForState("SC")).toBe("America/New_York");
    expect(timezoneForState("New York")).toBe("America/New_York");
  });

  it("REQ-255 an unknown or empty state has no zone", () => {
    expect(timezoneForState("")).toBeUndefined();
    expect(timezoneForState(undefined)).toBeUndefined();
    expect(timezoneForState(null)).toBeUndefined();
    expect(timezoneForState("ZZ")).toBeUndefined();
  });

  it("REQ-255 every state maps to a zone Intl knows", () => {
    const codes = [
      "AL",
      "AK",
      "AZ",
      "AR",
      "CA",
      "CO",
      "CT",
      "DE",
      "DC",
      "FL",
      "GA",
      "HI",
      "ID",
      "IL",
      "IN",
      "IA",
      "KS",
      "KY",
      "LA",
      "ME",
      "MD",
      "MA",
      "MI",
      "MN",
      "MS",
      "MO",
      "MT",
      "NE",
      "NV",
      "NH",
      "NJ",
      "NM",
      "NY",
      "NC",
      "ND",
      "OH",
      "OK",
      "OR",
      "PA",
      "RI",
      "SC",
      "SD",
      "TN",
      "TX",
      "UT",
      "VT",
      "VA",
      "WA",
      "WV",
      "WI",
      "WY",
      "PR",
    ];
    for (const c of codes) {
      const tz = timezoneForState(c);
      expect([c, typeof tz]).toEqual([c, "string"]);
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: tz })).not
        .toThrow();
    }
  });

  it("REQ-255 the picked zone wins; unset falls to the state; nothing falls to New York", () => {
    expect(businessTimezone({ timezone: "Pacific/Honolulu", state: "TX" }))
      .toBe("Pacific/Honolulu");
    expect(businessTimezone({ state: "TX" })).toBe("America/Chicago");
    expect(businessTimezone({ timezone: "", state: "TX" })).toBe(
      "America/Chicago",
    );
    expect(businessTimezone({ timezone: "Mars/Olympus", state: "AZ" })).toBe(
      "America/Phoenix",
    );
    expect(businessTimezone({})).toBe(DEFAULT_TIMEZONE);
    expect(DEFAULT_TIMEZONE).toBe("America/New_York");
  });

  it("REQ-255 the Settings time-zone select shows the derived zone, not a hard-coded New York", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../front-end/islands/SettingsPage.tsx"),
      "utf8",
    );
    expect(src).not.toContain('timezone ?? "America/New_York"');
    expect(src).toMatch(
      /businessTimezone\(\{[\s\S]{0,120}snapshot\.address\?\.state/,
    );
  });
});
