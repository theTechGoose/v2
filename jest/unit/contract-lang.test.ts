/**
 * REQ-048 (2026-09-30), Raphael: "the contract should be english first and
 * then there should be a toggle to turn the contract to spanish in real time.
 * should be easy to view in whatever language you want."
 *
 * The /q route resolves the contract's FIRST language through one shared
 * function: an explicit ?lang= on the link, then the visitor's own pm_lang
 * pick, else English — the contractor's comms language is NOT an input.
 */
import { resolveContractLang } from "../../shared/quote-flow/public-lang";

describe("REQ-048 resolveContractLang — English first", () => {
  it("REQ-048 no choice anywhere → English", () => {
    expect(resolveContractLang({})).toBe("en");
    expect(resolveContractLang({ query: null, cookie: null })).toBe("en");
    expect(resolveContractLang({ query: "", cookie: "pm_session=abc" })).toBe("en");
  });

  it("REQ-048 the visitor's pm_lang pick is honored (both separators the proxy may join with)", () => {
    expect(resolveContractLang({ cookie: "pm_lang=es" })).toBe("es");
    expect(resolveContractLang({ cookie: "pm_session=abc; pm_lang=es" })).toBe("es");
    expect(resolveContractLang({ cookie: "pm_session=abc, pm_lang=en" })).toBe("en");
  });

  it("REQ-048 an explicit ?lang= on the link beats the cookie; junk is ignored", () => {
    expect(resolveContractLang({ query: "en", cookie: "pm_lang=es" })).toBe("en");
    expect(resolveContractLang({ query: "es", cookie: "pm_lang=en" })).toBe("es");
    expect(resolveContractLang({ query: "fr", cookie: "pm_lang=es" })).toBe("es");
    expect(resolveContractLang({ query: "fr" })).toBe("en");
  });
});
