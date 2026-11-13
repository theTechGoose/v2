/**
 * REQ-729 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue m16: "Red/coral marks good
 * or neutral state".
 *
 *   (a) /invoices hero: "All clear — nothing outstanding." painted its good
 *       news in --brand-pink, because `.qph__title em` is pink in every mode.
 *   (b) /i/:id: the owner's preview of a Draft INV-001 or a Scheduled INV-002
 *       showed a pink "DUE" pill next to "Version 1 · Draft" / "Scheduled" —
 *       StatusPill only knew paid / claimed / pastDue, everything else fell
 *       to "Due".
 *
 * Targets: front-end/lib/headline-counts.ts invoicesHeroGood,
 * front-end/lib/invoice-status-pill.ts invoiceStatusPill, and their bindings
 * in InvoicesPage.tsx, quotes.css and routes/i/[id].tsx.
 */
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hc = () => require("../../front-end/lib/headline-counts");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pill = () => require("../../front-end/lib/invoice-status-pill");

const en = JSON.parse(read("lang/en.json"));
const es = JSON.parse(read("lang/es.json"));
const fill = (s: string, vars: Record<string, string> = {}) =>
  s.replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? `{${k}}`);
/** What the pill reads: its key in that language's dictionary, filled. */
const pillFor = (input: Record<string, unknown>, lang: "en" | "es") => {
  const p = pill().invoiceStatusPill(input, lang);
  return { ...p, label: fill((lang === "es" ? es : en)[p.key], p.vars) };
};

describe("REQ-729 m16 (a) /invoices hero — good news is not in the alarm colour", () => {
  it("REQ-729 'clear' and 'empty' are good-tone headlines; money-owed modes are not", () => {
    const { invoicesHeroGood } = hc();
    expect(invoicesHeroGood("clear")).toBe(true);
    expect(invoicesHeroGood("empty")).toBe(true);
    for (
      const m of ["claimed", "scheduled", "thisWeek", "nextWeek", "outstanding"]
    ) {
      expect(invoicesHeroGood(m)).toBe(false);
    }
  });

  it("REQ-729 quotes.css paints a good-tone title's <em> green, not pink", () => {
    const css = read("front-end/static/quotes.css");
    const rule = css.match(/\.qph__title--good\s+em\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/color:\s*var\(--brand-green\)/);
  });

  it("REQ-729 the /invoices hero <h1> carries qph__title--good from invoicesHeroGood(mode)", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/invoicesHeroGood\(mode\)/);
    expect(src).toMatch(/qph__title--good/);
  });
});

describe("REQ-729 m16 (b) /i/:id status pill — a draft or scheduled bill is not 'Due'", () => {
  const base = { paid: false, claimed: false, pastDue: false };

  it("REQ-729 the owner's preview of a draft reads a grey 'Draft' pill", () => {
    const p = pillFor({ ...base, status: "draft", internal: true }, "en");
    expect(p.kind).toBe("draft");
    expect(p.tone).toBe("neutral");
    expect(p.label).toBe("Draft");
    expect(pillFor({ ...base, status: "draft", internal: true }, "es").label)
      .toBe("Borrador");
  });

  it("REQ-729 a draft with a past due date is still 'Draft', never 'Past due'", () => {
    const p = pillFor({
      ...base,
      pastDue: true,
      status: "draft",
      internal: true,
    }, "en");
    expect(p.kind).toBe("draft");
  });

  it("REQ-729 the owner's preview of a scheduled installment reads a teal 'Scheduled · sends <date>'", () => {
    const p = pillFor(
      {
        ...base,
        status: "scheduled",
        internal: true,
        scheduledFor: "2026-12-01",
      },
      "en",
    );
    expect(p.kind).toBe("scheduled");
    expect(p.tone).toBe("teal");
    expect(p.label).toBe("Scheduled · sends Dec 1");
    const pes = pillFor(
      {
        ...base,
        status: "scheduled",
        internal: true,
        scheduledFor: "2026-12-01",
      },
      "es",
    );
    expect(pes.label).toBe("Programada · se envía 1 dic");
    // no date known → just the state word
    expect(
      pillFor({ ...base, status: "scheduled", internal: true }, "en").label,
    )
      .toBe("Scheduled");
  });

  it("REQ-729 an issued open bill keeps the pink 'Due'; overdue keeps 'Past due'; paid/claimed unchanged", () => {
    expect(pillFor({ ...base, status: "sent" }, "en")).toMatchObject({
      kind: "due",
      tone: "due",
      label: "Due",
    });
    expect(pillFor({ ...base, status: "viewed", internal: true }, "en").kind)
      .toBe("due");
    expect(pillFor({ ...base, pastDue: true, status: "sent" }, "en"))
      .toMatchObject({ kind: "pastDue", label: "Past due" });
    expect(pillFor({ ...base, paid: true, status: "paid" }, "en").kind).toBe(
      "paid",
    );
    expect(pillFor({ ...base, claimed: true, status: "claimed" }, "en").kind)
      .toBe("claimed");
  });

  it("REQ-729 (REQ-558 kept) a customer is never told an owner-only state — a scheduled bill reads 'Due' to them", () => {
    const p = pillFor({
      ...base,
      status: "scheduled",
      scheduledFor: "2026-12-01",
    }, "es");
    expect(p.kind).toBe("due");
    expect(p.label).not.toMatch(/Programada/);
    expect(pillFor({ ...base, status: "draft" }, "en").kind).toBe("due");
  });

  it("REQ-729 the pill keys exist in en and es", () => {
    for (
      const k of [
        "publicInvoice.status.draft",
        "publicInvoice.status.scheduled",
        "publicInvoice.status.scheduledSends",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
    }
    expect(fill(en["publicInvoice.status.scheduledSends"], { date: "Dec 1" }))
      .toBe("Scheduled · sends Dec 1");
  });

  it("REQ-729 /i/[id].tsx's StatusPill is driven by invoiceStatusPill with the invoice status, internal flag and scheduledFor", () => {
    const src = read("front-end/routes/i/[id].tsx");
    expect(src).toMatch(/invoiceStatusPill\(/);
    const call = src.match(/<StatusPill[\s\S]*?\/>/);
    expect(call).not.toBeNull();
    expect(call![0]).toMatch(/status=\{invoice\.status\}/);
    expect(call![0]).toMatch(/internal=\{invoice\.internal === true\}/);
    expect(call![0]).toMatch(/scheduledFor=\{invoice\.scheduledFor\}/);
  });
});
