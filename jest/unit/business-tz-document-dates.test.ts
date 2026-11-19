/**
 * REQ-944 (LOOP-007 cycle 1, q1-10) — documents sent in the evening carried
 * the next day's date. An Austin, TX business (Central) sent Q-001 at
 * 2026-11-19T01:37Z = 7:37 PM CST on Wed Nov 18; the agreement page, the
 * contractor's signature date and the app header all read Nov 19.
 *
 * Target: shared/quote-flow/format-helpers.ts `formatLongDate` (the /q page's
 * one long-date formatter, via front-end/components/doc-parts.tsx fmtDate)
 * reads getUTC* — the UTC day — for full timestamps; the seven app routes
 * build the header date from the server's own zone; the chat clocks format in
 * the device's zone.
 */
import * as fs from "fs";
import * as path from "path";
import { formatLongDate } from "../../shared/quote-flow/format-helpers";
import { formatClockTime } from "../../shared/quote-flow/locale-format";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// the business-zone parameter is what the fix adds (diagnostics are off)
const longDate = formatLongDate as unknown as (
  iso: string | undefined,
  lang: "en" | "es",
  tz?: string,
) => string;

const EVENING_SEND = "2026-11-19T01:37:00.000Z"; // 7:37 PM CST, Nov 18

describe("REQ-944 q1-10: document dates are the business's day, not the UTC day", () => {
  it("REQ-944 formatLongDate prints a full timestamp's day in the business time zone", () => {
    expect(longDate(EVENING_SEND, "es", "America/Chicago")).toBe(
      "18 de noviembre de 2026",
    );
    expect(longDate(EVENING_SEND, "en", "America/Chicago")).toBe(
      "November 18, 2026",
    );
    expect(longDate(EVENING_SEND, "en", "America/New_York")).toBe(
      "November 18, 2026",
    );
    // a morning-in-Asia zone moves it forward, the same way
    expect(longDate("2026-11-18T20:00:00Z", "en", "Asia/Tokyo")).toBe(
      "November 19, 2026",
    );
  });

  it("REQ-944 a bare YYYY-MM-DD keeps its calendar day in every zone", () => {
    for (const tz of ["Etc/GMT+12", "America/Chicago", "Pacific/Kiritimati"]) {
      expect(longDate("2026-11-19", "es", tz)).toBe("19 de noviembre de 2026");
      expect(longDate("2026-11-19", "en", tz)).toBe("November 19, 2026");
    }
  });

  it("REQ-944 the app header's date is not built from the server's own zone (Date#getDay/getMonth/getDate)", () => {
    const routes = [
      "dashboard",
      "invoices",
      "payments",
      "reports",
      "clients",
      "settings",
      "admin",
    ];
    const offenders = routes.filter((r) =>
      /\bnow\.get(?:Day|Month|Date)\(\)/.test(
        read(`front-end/routes/${r}/index.tsx`),
      )
    );
    expect(offenders).toEqual([]);
  });

  it("REQ-944 a chat clock prints the business's wall time (7:32 p. m. Central for 01:32Z)", () => {
    expect(
      formatClockTime("2026-11-19T01:32:00Z", "es", {
        timeZone: "America/Chicago",
      }),
    ).toBe("7:32 p. m.");
    expect(
      formatClockTime("2026-11-19T01:32:00Z", "en", {
        timeZone: "America/New_York",
      }),
    ).toBe("8:32 PM");
  });

  it("REQ-944 chat and list clocks name a time zone instead of the device's", () => {
    // the LIVE chat island (routes/assistant/*.tsx import islands/AsstChat.tsx);
    // ui-breakdown/ is the excluded design mock, which no route serves
    const chat = read("front-end/islands/AsstChat.tsx");
    const fmtTime = chat.match(/function fmtTime\([\s\S]*?\n}/)?.[0] ?? "";
    expect(fmtTime).toMatch(/timeZone/);
    const comms = read("front-end/lib/communications.ts");
    const shortTime = comms.match(/function shortTime\([\s\S]*?\n}/)?.[0] ??
      "";
    expect(shortTime).toMatch(/timeZone/);
  });
});
