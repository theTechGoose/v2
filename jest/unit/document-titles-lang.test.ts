/**
 * REQ-497 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3, issue m23: "Documents mix languages (INV-002
 * title Spanish on /i?lang=en; English job names on the Spanish dashboard)".
 *
 * RCA: DashboardPage's quoteToRow rendered `q.summary` and jobToRow
 * `j.quote.summary` — the primary text, whatever language it was written in —
 * though /quotes already titles a quote with quoteJobTitle(q, lang)
 * (REQ-394). A standalone invoice (no quote) had no per-language text at all,
 * so /i?lang=en showed the Spanish title the contractor typed.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { invoiceTextByLang } from "../../shared/documents/invoice-lang";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("REQ-497 (demo m23, cycle 3): the dashboard titles rows in the app's language", () => {
  const src = read("front-end/islands/DashboardPage.tsx");
  it("the job row's task is jobRowTitle(j, lang), not the primary summary", () => {
    expect(src).toMatch(/task:\s*jobRowTitle\(j,\s*lang\)/);
    expect(src).not.toMatch(/task:\s*j\.quote\.summary/);
  });
  it("the quote row's desc is quoteRowTitle(q, lang), not the primary summary", () => {
    expect(src).toMatch(/desc:\s*quoteRowTitle\(q,\s*lang\)/);
    expect(src).not.toMatch(/desc:\s*q\.summary/);
  });
});

describe("REQ-497 (demo m23, cycle 3): a standalone invoice's per-language text", () => {
  const translated = {
    lang: "es",
    jobName: "Reparación de cerca",
    description: "Cambiar 3 postes\nPintar la cerca",
    jobNameByLang: { es: "Reparación de cerca", en: "Fence Repair" },
    descriptionByLang: {
      es: "Cambiar 3 postes\nPintar la cerca",
      en: "Replace 3 posts\nPaint the fence",
    },
  };
  it("is projected when the cache was built from the current text", () => {
    expect(invoiceTextByLang(translated)).toEqual({
      jobNameByLang: translated.jobNameByLang,
      descriptionByLang: translated.descriptionByLang,
    });
  });
  it("a renamed invoice drops the stale name map (the typed text shows, never an old translation)", () => {
    const renamed = { ...translated, jobName: "Cerca nueva" };
    expect(invoiceTextByLang(renamed)).toEqual({
      descriptionByLang: translated.descriptionByLang,
    });
  });
  it("an edited description drops the stale description map", () => {
    const edited = { ...translated, description: "Cambiar 4 postes" };
    expect(invoiceTextByLang(edited)).toEqual({
      jobNameByLang: translated.jobNameByLang,
    });
  });
  it("nothing to project without a base language or a cache", () => {
    expect(invoiceTextByLang({ jobName: "Reparación de cerca" })).toEqual({});
    expect(invoiceTextByLang({ ...translated, lang: undefined })).toEqual({});
  });
  it("blank lines and stray spaces in the stored description don't make the cache stale", () => {
    const spaced = {
      ...translated,
      description: "  Cambiar 3 postes \n\n Pintar la cerca ",
    };
    expect(invoiceTextByLang(spaced).descriptionByLang).toEqual(
      translated.descriptionByLang,
    );
  });
});
