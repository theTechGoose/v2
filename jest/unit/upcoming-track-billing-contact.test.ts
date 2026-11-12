/**
 * REQ-567 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 4 (run r857a9d67), issue m37: "Only invoice in collapsed 04
 * Upcoming; 'No billing email' with no text option for phone-only client".
 *
 * (1) QuoteTrack wrote its open state to localStorage from a mount effect, so a
 *     visit to /invoices while Upcoming was empty stored "0" (defaultOpen was
 *     false) and that "0" then beat defaultOpen=true once the track had items.
 *     Only a user's own toggle may be remembered (front-end/lib/track-open.ts).
 * (2) missingInfo warned "No billing email" for a client with a phone even
 *     though the form sends the bill by text; it now warns `noContact` only when
 *     both email and phone are empty, and a phone-only client reads "Will be
 *     sent by text".
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const trackMod = () => require("../../front-end/lib/track-open");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const formMod = () => require("../../shared/documents/invoice-form");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json"));
const es = JSON.parse(read("lang/es.json"));

function memStorage() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe("REQ-567 (cycle 4, m37) a track's open state is remembered only from a user toggle", () => {
  it("REQ-567 an empty-track visit then a visit with items: Upcoming opens", () => {
    const { initialTrackOpen } = trackMod();
    const s = memStorage();
    const key = "invoices:track:upcoming";
    // visit 1: Upcoming empty → closed, and nothing is written
    expect(
      initialTrackOpen({ storage: s, storageKey: key, defaultOpen: false }),
    )
      .toBe(false);
    expect(s.m.size).toBe(0);
    // visit 2: the invoice is scheduled → defaultOpen true wins
    expect(initialTrackOpen({ storage: s, storageKey: key, defaultOpen: true }))
      .toBe(true);
  });

  it("REQ-567 a user's collapse/expand is remembered and wins over defaultOpen", () => {
    const { initialTrackOpen, toggleTrackOpen } = trackMod();
    const s = memStorage();
    const key = "quotes:track:1";
    expect(toggleTrackOpen(s, key, true)).toBe(false);
    expect(initialTrackOpen({ storage: s, storageKey: key, defaultOpen: true }))
      .toBe(false);
    expect(toggleTrackOpen(s, key, false)).toBe(true);
    expect(
      initialTrackOpen({ storage: s, storageKey: key, defaultOpen: false }),
    )
      .toBe(true);
  });

  it("REQ-567 a legacy '0'/'1' (possibly written by the old mount effect) is ignored", () => {
    const { initialTrackOpen } = trackMod();
    const s = memStorage();
    s.setItem("invoices:track:upcoming", "0");
    expect(initialTrackOpen({
      storage: s,
      storageKey: "invoices:track:upcoming",
      defaultOpen: true,
    })).toBe(true);
  });

  it("REQ-567 forceOpen wins; no storage / no key falls back to defaultOpen; storage errors are swallowed", () => {
    const { initialTrackOpen, toggleTrackOpen } = trackMod();
    const s = memStorage();
    expect(toggleTrackOpen(s, "k", true)).toBe(false);
    expect(
      initialTrackOpen({
        storage: s,
        storageKey: "k",
        defaultOpen: false,
        forceOpen: true,
      }),
    )
      .toBe(true);
    expect(
      initialTrackOpen({
        storage: undefined,
        storageKey: "k",
        defaultOpen: true,
      }),
    )
      .toBe(true);
    expect(initialTrackOpen({ storage: s, defaultOpen: false })).toBe(false);
    const boom = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(
      initialTrackOpen({ storage: boom, storageKey: "k", defaultOpen: true }),
    )
      .toBe(true);
    expect(toggleTrackOpen(boom, "k", true)).toBe(false);
  });

  it("REQ-567 QuoteTrack persists from the click handler, never from an effect", () => {
    const src = read("front-end/islands/QuoteTrack.tsx");
    expect(src).not.toMatch(/setItem/);
    expect(src).toMatch(/toggleTrackOpen\(/);
    expect(src).toMatch(/initialTrackOpen\(/);
    // no effect body touches storage
    for (const m of src.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)) {
      expect(m[1]).not.toMatch(/localStorage|toggleTrackOpen/);
    }
  });
});

describe("REQ-567 (cycle 4, m37) a phone-only client is not 'missing' a billing email", () => {
  const base = {
    serviceAddress: "1 Main",
    lineItems: [{ description: "x", quantity: 1, price: 100 }],
    amountCents: 100,
  };

  it("REQ-567 phone only → no contact warning", () => {
    const { missingInfo } = formMod();
    expect(missingInfo({
      ...base,
      billTo: {
        name: "Ann",
        email: "",
        phoneNumber: "5125550100",
        address: "",
      },
    })).toEqual([]);
  });

  it("REQ-567 neither email nor phone → noContact (not noBillingEmail)", () => {
    const { missingInfo } = formMod();
    const out = missingInfo({
      ...base,
      billTo: { name: "Ann", email: " ", phoneNumber: "", address: "" },
    });
    expect(out).toEqual(["noContact"]);
    expect(out).not.toContain("noBillingEmail");
  });

  it("REQ-567 sendChannel names how the bill goes out", () => {
    const { sendChannel } = formMod();
    expect(sendChannel({ email: "", phoneNumber: "5125550100" })).toBe("text");
    expect(sendChannel({ email: "a@x.com", phoneNumber: "" })).toBe("email");
    expect(sendChannel({ email: "a@x.com", phoneNumber: "5125550100" })).toBe(
      "both",
    );
    expect(sendChannel({ email: " ", phoneNumber: "" })).toBe("none");
  });

  it("REQ-567 en/es carry noContact and the by-text note; noBillingEmail is gone", () => {
    for (const d of [en, es]) {
      expect(d["invoices.form.missing.noContact"]).toBeTruthy();
      expect(d["invoices.form.sendByText"]).toBeTruthy();
      expect(d["invoices.form.missing.noBillingEmail"]).toBeUndefined();
    }
    expect(en["invoices.form.sendByText"]).toBe("Will be sent by text");
  });

  it("REQ-567 the new-invoice form feeds the phone into missingInfo and shows the by-text note", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/sendChannel\(/);
    expect(src).toMatch(/invoices\.form\.sendByText/);
    expect(src).toMatch(/data-cy="new-invoice-by-text"/);
  });
});
