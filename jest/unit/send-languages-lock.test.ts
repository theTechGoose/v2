/**
 * REQ-925 — Raphael, 2026-11-18: "if in settings english is only selected it
 * should not be possible to get an invoice quote or comunication that is in
 * spanish. because only english is selected."
 *
 * The one outbound resolution (shared/quote-flow/comms-language.ts) now takes
 * the account's send-in set (identity.commsLanguages) and never answers a
 * language outside it — not for a per-send pick, not for the customer's own
 * language (REQ-715), not for a stale stored default.
 */
import {
  clampOptionalToSendLanguages,
  clampToSendLanguages,
  resolveCommsLanguage,
  withSendLanguageDefault,
} from "../../shared/quote-flow/comms-language";

describe("REQ-925 resolveCommsLanguage honours Settings → Languages you send in", () => {
  it("REQ-925 English only: a Spanish pick, a Spanish customer and a stale Spanish default all resolve to English", () => {
    const only = ["en"];
    expect(resolveCommsLanguage({ override: "es", sendLanguages: only })).toBe(
      "en",
    );
    expect(
      resolveCommsLanguage({ customerLanguage: "es", sendLanguages: only }),
    ).toBe("en");
    expect(
      resolveCommsLanguage({
        identityCommsLanguage: "es",
        sendLanguages: only,
      }),
    ).toBe("en");
    expect(
      resolveCommsLanguage({
        override: "es",
        customerLanguage: "es",
        identityCommsLanguage: "es",
        sendLanguages: only,
      }),
    ).toBe("en");
  });

  it("REQ-925 Spanish only: everything resolves to Spanish", () => {
    expect(resolveCommsLanguage({ override: "en", sendLanguages: ["es"] }))
      .toBe("es");
    expect(resolveCommsLanguage({ sendLanguages: ["es"] })).toBe("es");
  });

  it("REQ-925 both ticked: REQ-715 / UX-28 precedence is unchanged", () => {
    const both = ["en", "es"];
    expect(
      resolveCommsLanguage({ customerLanguage: "es", sendLanguages: both }),
    ).toBe("es");
    expect(
      resolveCommsLanguage({
        override: "en",
        customerLanguage: "es",
        sendLanguages: both,
      }),
    ).toBe("en");
    expect(resolveCommsLanguage({ sendLanguages: both })).toBe("en");
  });

  it("REQ-925 a disallowed pick falls through to the next allowed source", () => {
    expect(
      resolveCommsLanguage({
        override: "es",
        customerLanguage: "en",
        sendLanguages: ["en"],
      }),
    ).toBe("en");
  });

  it("REQ-925 no stored set (legacy account): the old precedence", () => {
    expect(resolveCommsLanguage({ customerLanguage: "es" })).toBe("es");
    expect(resolveCommsLanguage({ customerLanguage: "es", sendLanguages: [] }))
      .toBe("es");
    expect(
      resolveCommsLanguage({ customerLanguage: "es", sendLanguages: null }),
    ).toBe("es");
  });

  it("REQ-925 clampToSendLanguages / clampOptionalToSendLanguages", () => {
    expect(clampToSendLanguages("es", ["en"])).toBe("en");
    expect(clampToSendLanguages("es", undefined)).toBe("es");
    expect(clampToSendLanguages(undefined, ["es"])).toBe("es");
    expect(clampOptionalToSendLanguages(undefined, ["en"])).toBeUndefined();
    expect(clampOptionalToSendLanguages("es", ["en"])).toBe("en");
    expect(clampOptionalToSendLanguages("es", ["en", "es"])).toBe("es");
  });

  it("REQ-925 withSendLanguageDefault: a stale Spanish default reads as English once Spanish is unticked", () => {
    expect(
      withSendLanguageDefault({ commsLanguage: "es", commsLanguages: ["en"] })
        .commsLanguage,
    ).toBe("en");
    expect(
      withSendLanguageDefault({
        commsLanguage: "es",
        commsLanguages: ["en", "es"],
      })
        .commsLanguage,
    ).toBe("es");
    expect(withSendLanguageDefault({ commsLanguage: "es" }).commsLanguage).toBe(
      "es",
    );
  });
});
