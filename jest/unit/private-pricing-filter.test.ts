/**
 * REQ-659 — demo-loop cycle 5, issues M14 / m53 / c1-M22: the contractor's
 * private pricing reached customer job details. REQ-261's filter only knew
 * "$N" / "N dollars", so "Materials at cost +15%" (a markup), "85/hr labor"
 * (a rate) and "My sub quoted me for the plumbing" (a sub cost, amount
 * stripped) passed; the confirm strip echoed the private cost; and a finished
 * job's invoice still printed the quote's relative start ("Next week").
 */
import * as fs from "fs";
import * as path from "path";

type Lang = "en" | "es";
type Term = { stepId: string; label: string; value: string };
type Cost = {
  mentionsMoney: (line: string) => boolean;
  withoutMoneySentences: (text: string) => string;
  redactMoney: (text: string) => string;
};
type Scope = {
  scopeBulletsFromRaw: (
    raw: string,
    lang: Lang,
  ) => { bullets: string[]; degraded: boolean };
  scopeDescriptionFromRaw: (raw: string, lang: Lang) => string;
};
type Own = {
  ownWordsOption: (
    raw: string,
    lang: Lang,
  ) => { jobName: string; summary: string; bullets: string[] } | null;
};
type InvTerms = {
  invoiceTerms: (
    terms: Term[] | null | undefined,
    at: { quotedAt?: string; issuedAt?: string },
  ) => Term[];
};

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/* eslint-disable @typescript-eslint/no-var-requires */
const cost: Cost = require("../../shared/quote-flow/private-cost");
const scope: Scope = require("../../shared/quote-flow/scope-from-raw");
const own: Own = require("../../shared/quote-flow/own-words-option");
const en: Record<string, string> = require("../../lang/en.json");
const es: Record<string, string> = require("../../lang/es.json");
const inv = (): InvTerms => require("../../shared/quote-flow/invoice-terms");
/* eslint-enable @typescript-eslint/no-var-requires */

describe("REQ-659 (cycle 5, M14/m53/c1-M22) private pricing never reaches customer job details", () => {
  test.each([
    "Materials at cost +15%",
    "Materials at cost",
    "Cost plus 20% on materials",
    "15% markup on fixtures",
    "Markup on materials",
    "20% over cost",
    "85/hr labor",
    "Labor 85 per hour",
    "Labor at 90 an hour",
    "Mano de obra 85 por hora",
    "My margin is 20%",
    "Overhead and profit 10%",
    "10% overhead",
    "Profit on the job",
    "My sub quoted me for the plumbing",
    "The electrician charges me for the panel",
    "Tile costs me 4.50 a foot",
    "My cost on the vanity",
    "El plomero me cobra por la instalación",
    "Los materiales me cuestan mucho",
    "Materiales al costo más 15%",
    "Recargo del 10% en materiales",
  ])("REQ-659 mentionsMoney flags private pricing: %s", (line) => {
    expect(cost.mentionsMoney(line)).toBe(true);
  });

  test.each([
    "Install overhead lighting",
    "Overhead garage door repair",
    "Grade the yard to a 2% slope",
    "Paint 1,500 sqft interior",
    "Remove 2 hours of brush",
    "Haul away debris",
    "Replace kitchen faucet",
    "Media camioneta de basura",
    "Instalar luces en el techo",
    "Leave a 1 inch margin at the wall",
  ])("REQ-659 mentionsMoney leaves scope lines alone: %s", (line) => {
    expect(cost.mentionsMoney(line)).toBe(false);
  });

  test("REQ-659 withoutMoneySentences drops the markup and rate sentences", () => {
    expect(
      cost.withoutMoneySentences(
        "Kitchen backsplash tile. Materials at cost +15%. Labor 85/hr. Grout and seal.",
      ),
    ).toBe("Kitchen backsplash tile. Grout and seal.");
    expect(
      cost.withoutMoneySentences(
        "Retiro de muebles viejos y basura de un garaje, media camioneta, $450. Cargo por disposición de basura $75.",
      ),
    ).toBe("");
  });

  test("REQ-659 scopeBulletsFromRaw drops a sub-cost line once its amount is stripped", () => {
    const { bullets } = scope.scopeBulletsFromRaw(
      "Replace the water heater. My sub quoted me $2800 for the plumbing. Materials at cost +15%",
      "en",
    );
    expect(bullets).toEqual(["Replace the water heater"]);
    expect(
      scope.scopeDescriptionFromRaw(
        "Pintar la sala. El pintor me cobra $900. Mano de obra 85 por hora",
        "es",
      ),
    ).toBe("Pintar la sala");
  });

  test("REQ-659 ownWordsOption never carries a private cost, scoped or as typed", () => {
    const opt = own.ownWordsOption(
      "Replace the water heater\nMy sub quoted me $2800 for the plumbing",
      "en",
    );
    expect(opt!.bullets).toEqual(["Replace the water heater"]);
    // The as-typed fallback (no scope line survives) drops priced lines too.
    const typed = own.ownWordsOption("ok\n$500", "en");
    expect(typed!.bullets).toEqual(["ok"]);
    expect(own.ownWordsOption("$2800\n85/hr", "en")).toBeNull();
  });

  test("REQ-659 redactMoney hides every amount, keeps the words", () => {
    expect(
      cost.redactMoney(
        "Water heater. My sub quoted me $2,800. Labor 85/hr, materials at cost +15%, 900 dólares",
      ),
    ).toBe(
      "Water heater. My sub quoted me $•••. Labor •••/hr, materials at cost +•••%, ••• dólares",
    );
  });

  test("REQ-659 the confirm strip echoes the typed message with money redacted", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(
      /class=\{`chat__confirm-details-text[\s\S]{0,900}?\{redactMoney\(pendingJobDetailsRaw\)\}/,
    );
  });

  test("REQ-659 the job-options prompt forbids rates, markup and costs in a bullet (en + es)", () => {
    for (const dict of [en, es]) {
      const p = dict["prompts.generateJobOptions"];
      expect(p).toMatch(/PRIVATE PRICING/);
      expect(p).toMatch(/markup/i);
      expect(p).toMatch(/hourly rate/i);
      expect(p).toMatch(/subcontractor/i);
    }
  });
});

describe("REQ-659 (cycle 5, m53) a finished job's invoice drops the stale relative start", () => {
  const terms: Term[] = [
    { stepId: "start_date", label: "Start date", value: "Next week" },
    { stepId: "payment_terms", label: "Payment terms", value: "50 / 50" },
  ];

  test("issued after the start it pointed to → the start term is gone, the rest stays", () => {
    expect(
      inv().invoiceTerms(terms, {
        quotedAt: "2026-10-01T10:00:00Z",
        issuedAt: "2026-11-12",
      }),
    ).toEqual([terms[1]]);
  });

  test("a deposit bill issued the day the quote went out keeps it", () => {
    expect(
      inv().invoiceTerms(terms, {
        quotedAt: "2026-11-12T10:00:00Z",
        issuedAt: "2026-11-12",
      }),
    ).toEqual(terms);
  });

  test("Spanish preset, ASAP and TBD; a concrete date always stays", () => {
    const at = { quotedAt: "2026-10-01T10:00:00Z", issuedAt: "2026-11-12" };
    for (const value of ["La próxima semana", "ASAP", "To be determined"]) {
      expect(
        inv().invoiceTerms([{ stepId: "start_date", label: "x", value }], at),
      ).toEqual([]);
    }
    const dated = [{ stepId: "start_date", label: "x", value: "2026-10-15" }];
    expect(inv().invoiceTerms(dated, at)).toEqual(dated);
    expect(inv().invoiceTerms(undefined, at)).toEqual([]);
  });
});
