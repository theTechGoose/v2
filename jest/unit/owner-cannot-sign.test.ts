/**
 * REQ-306 — demo cycle 1 issue B3: a logged-in contractor opening "View as
 * customer" could sign the client's agreement with no warning. The public
 * payload now carries `internal: true` for the business's own viewer, the
 * document shows a preview banner instead of the pad, the accept refuses the
 * owner (409 owner_cannot_sign), and `?as=customer&confirm=1` is the explicit
 * in-person override.
 *
 *   shared/quote-flow/public-doc-state.ts → internalPreview(), hasSignOverride()
 *   shared/documents/linked-view.ts       → acceptDecision() owner_cannot_sign
 *   front-end/components/quote-doc.tsx    → banner (data-cy="quote-internal-preview")
 *   front-end/islands/PublicSignQuote.tsx → posts the override
 *   lang/{en,es}.json                     → public.doc.internalPreview*
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pds = () => require("../../shared/quote-flow/public-doc-state");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = () => require("../../shared/documents/linked-view");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const lang = (l: string) =>
  JSON.parse(read(`lang/${l}.json`)) as Record<string, string>;

describe("REQ-306 internalPreview — the business's own viewer sees a preview, not a pad", () => {
  it("REQ-306 an internal viewer of an open quote is a preview; the customer (no flag) is not", () => {
    const { internalPreview } = pds();
    expect(internalPreview({ id: "q1", status: "sent", internal: true }, ""))
      .toBe(true);
    expect(internalPreview({ id: "q1", status: "sent" }, "")).toBe(false);
    expect(internalPreview({ id: "q1", status: "sent", internal: false }, ""))
      .toBe(false);
  });

  it("REQ-306 the explicit in-person override (?as=customer&confirm=1) shows the pad to an internal viewer; a partial override does not", () => {
    const { internalPreview, hasSignOverride, SIGN_OVERRIDE_QUERY } = pds();
    expect(SIGN_OVERRIDE_QUERY).toBe("as=customer&confirm=1");
    expect(hasSignOverride("?as=customer&confirm=1")).toBe(true);
    expect(hasSignOverride("?lang=es&as=customer&confirm=1")).toBe(true);
    expect(hasSignOverride("?as=customer")).toBe(false);
    expect(hasSignOverride("?confirm=1")).toBe(false);
    expect(hasSignOverride("")).toBe(false);
    expect(hasSignOverride(undefined)).toBe(false);
    expect(
      internalPreview(
        { id: "q1", status: "sent", internal: true },
        "?as=customer&confirm=1",
      ),
    ).toBe(false);
  });

  it("REQ-306 an already-signed or declined quote is never a preview (nothing to sign)", () => {
    const { internalPreview } = pds();
    expect(
      internalPreview({ id: "q1", status: "accepted", internal: true }, ""),
    ).toBe(false);
    expect(internalPreview({ id: "q1", status: "lost", internal: true }, ""))
      .toBe(false);
  });
});

describe("REQ-306 acceptDecision — the page understands the owner's refusal", () => {
  it("REQ-306 409 owner_cannot_sign is its own decision, not a generic error", () => {
    const { acceptDecision } = lv();
    expect(acceptDecision(409, { ok: false, reason: "owner_cannot_sign" }))
      .toEqual({ kind: "owner_cannot_sign" });
  });
});

describe("REQ-306 the document — banner instead of pad for an internal viewer", () => {
  const doc = read("front-end/components/quote-doc.tsx");
  const view = read("front-end/islands/PublicQuoteView.tsx");
  const pad = read("front-end/islands/PublicSignQuote.tsx");

  it("REQ-306 quote-doc renders the preview banner and gates the pad on internalPreview()", () => {
    expect(doc).toMatch(/internalPreview\(/);
    expect(doc).toContain('data-cy="quote-internal-preview"');
    // the pad is rendered only when the viewer is NOT previewing
    const padAt = doc.indexOf("<PublicSignQuote");
    const gate = doc.lastIndexOf("preview", padAt);
    expect(padAt).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(0);
    expect(doc.slice(gate, padAt)).toMatch(/\?\s*\(|:\s*\(|&&/);
  });

  it("REQ-306 the public payload type carries `internal`, and the view hands the page's query to the document", () => {
    expect(doc).toMatch(/internal\?: boolean/);
    expect(view).toMatch(/location\??\.search/);
    expect(view).toMatch(/search=\{/);
  });

  it("REQ-306 the pad posts the override so the in-person signature is accepted", () => {
    expect(pad).toMatch(/SIGN_OVERRIDE_QUERY/);
    expect(pad).toMatch(/owner_cannot_sign/);
  });

  it("REQ-306 the copy exists in both languages", () => {
    const en = lang("en");
    const es = lang("es");
    for (
      const k of [
        "public.doc.internalPreview",
        "public.doc.internalPreviewBody",
        "public.doc.internalPreviewSignInPerson",
        "public.doc.ownerCannotSign",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k]).not.toEqual(es[k]);
    }
    expect(en["public.doc.internalPreview"]).toMatch(/Preview/);
    expect(en["public.doc.internalPreview"]).toMatch(/signing is disabled/i);
  });
});
