/**
 * REQ-750 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5v1, issue p18-6a (re-verified NOT FIXED after
 * REQ-692): "Carmen Nunez" was accepted and stored for an agreement made out
 * to "Carmen Núñez". `signerNameOnFile` is the one rule the pad, the accept
 * endpoint and the signed document share: an accent/case/spacing-only
 * variant of the on-file name becomes the on-file spelling; any other name
 * is kept as typed (normalized).
 */
import { signerNameOnFile } from "../../shared/quote-flow/signer-name.ts";

describe("REQ-750 (cycle 5v1, p18-6a) signerNameOnFile", () => {
  test("an accent-only variant becomes the on-file spelling", () => {
    expect(signerNameOnFile("Carmen Nunez", "Carmen Núñez")).toBe(
      "Carmen Núñez",
    );
  });
  test("case and spacing variants become the on-file spelling", () => {
    expect(signerNameOnFile("  carmen   NÚÑEZ ", "Carmen Núñez")).toBe(
      "Carmen Núñez",
    );
  });
  test("a different name is kept as typed, normalized", () => {
    expect(signerNameOnFile(" Luis  Núñez", "Carmen Núñez")).toBe(
      "Luis Núñez",
    );
  });
  test("no name on file keeps the typed name", () => {
    expect(signerNameOnFile("Carmen Nunez", undefined)).toBe("Carmen Nunez");
  });
});
