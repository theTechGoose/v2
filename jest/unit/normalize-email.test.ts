/**
 * REQ-050 — "/login-internal … log in with email."
 *
 * The address a person types is matched against the `email` on a user
 * record. ONE pure helper decides what "the same address" means (trim +
 * lowercase) and what counts as an address at all, so the page, the
 * backend and the OTP key all agree.
 */
import { normalizeEmail } from "../../shared/quote-flow/normalize-email";

describe("REQ-050 normalizeEmail", () => {
  it("REQ-050 trims and lowercases a well-formed address", () => {
    expect(normalizeEmail("  Raphael@Example.COM ")).toBe(
      "raphael@example.com",
    );
  });

  it("REQ-050 keeps plus-addressing, dots and subdomains", () => {
    expect(normalizeEmail("r.castro+pm@mail.rcincorporated.net")).toBe(
      "r.castro+pm@mail.rcincorporated.net",
    );
  });

  it("REQ-050 answers null for anything that is not an address", () => {
    for (
      const bad of [
        "",
        "   ",
        "nope",
        "a@b",
        "a b@c.com",
        "@c.com",
        "a@",
        "a@@c.com",
      ]
    ) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });
});
