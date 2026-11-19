/**
 * REQ-1043 (LOOP-007 cycle 2, q2-27) — Settings → SITIO WEB accepted "reyes tile dot com": on
 * blur normalizeWebsiteUrl turned it into "https://reyes tile dot com" (which `new URL()`
 * rejects) and it was saved and published as a dead link on the customer's /i invoice. The
 * website needs a pure rule next to normalizeWebsiteUrl in shared/quote-flow/format-helpers.ts
 * — isValidWebsiteUrl(raw) — that the Settings card asks before it saves and the backend asks on
 * PUT /profile/identity. Blank stays allowed (it clears the website).
 */
import * as fh from "../../shared/quote-flow/format-helpers";

const isValidWebsiteUrl = (raw: string): boolean => {
  const fn = (fh as Record<string, unknown>).isValidWebsiteUrl;
  if (typeof fn !== "function") {
    throw new Error(
      "shared/quote-flow/format-helpers.ts has no isValidWebsiteUrl() — nothing refuses a junk website",
    );
  }
  return (fn as (s: string) => boolean)(raw);
};

describe("REQ-1043 q2-27 a junk website is refused, a real one is accepted", () => {
  it.each([
    ["reyes tile dot com"],
    ["asdf"],
    ["http://"],
    ["https://reyes tile dot com"],
  ])("REQ-1043 refuses %p", (raw) => {
    expect({ raw, valid: isValidWebsiteUrl(raw) }).toEqual({ raw, valid: false });
  });

  it.each([
    ["reyestile.com"],
    ["https://a2zlandscape.com/"],
    ["http://hans.work"],
    [""],
  ])("REQ-1043 accepts %p", (raw) => {
    expect({ raw, valid: isValidWebsiteUrl(raw) }).toEqual({ raw, valid: true });
  });

  it("REQ-1043 every value normalizeWebsiteUrl produces from a junk input is still refused", () => {
    const junk = "reyes tile dot com";
    const stored = fh.normalizeWebsiteUrl(junk);
    // today the normalizer hands this on as a link; the rule must catch it
    expect({ stored, valid: isValidWebsiteUrl(stored) }).toEqual({
      stored,
      valid: false,
    });
  });
});
