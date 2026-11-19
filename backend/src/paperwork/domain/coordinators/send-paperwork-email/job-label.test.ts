/**
 * REQ-1087 — Raphael: "test every single aspect of this application … one Opus
 * agent per issue to do root cause analysis, then one to write the test, then
 * one to fix it and make it green." LOOP-007 cycle 3, issue q3-4: "Same quote's
 * job named three different ways; quote email still uses the summary's
 * '— <customer>' tail".
 *
 * The chat model writes `summary` as "<job> — <customer>" (REQ-576) and a
 * separate `jobName`. renderQuoteSubject names the job by jobName, but
 * renderQuoteHtml builds the hero heading and the preheader from
 * quoteSummary(q, lang) with only a leading "Quote:" stripped, so the heading
 * reads "Exterior Painting And Fence Staining — Maria Lopez" under a subject
 * that says "Exterior Painting & Fence Staining", and the preheader names the
 * customer twice ("For Maria — … — Maria Lopez"). REQ-1046 fixed the signed
 * email and /quotes but never this coordinator.
 */
import { assert, assertEquals } from "#std/assert";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { renderQuoteHtml, renderQuoteSubject } from "./mod.ts";

const marcus = {
  id: "u-marcus",
  name: "Marcus Reyes",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;
const biz = (lang: "en" | "es") =>
  ({
    userId: "u-marcus",
    businessName: "Reyes Remodeling",
    commsLanguage: lang,
  }) as BusinessIdentity;

function quote(extra: Partial<Quote>): Quote {
  return {
    id: "q-4",
    userId: "u-marcus",
    number: "Q-001",
    version: 1,
    status: "sent",
    lineItems: [
      {
        description: "Paint exterior",
        quantity: 1,
        unit: "job",
        price: 420000,
      },
      { description: "Stain fence", quantity: 1, unit: "job", price: 180000 },
    ],
    estimatedTotal: 600000,
    createdAt: "2026-11-19T12:00:00Z",
    updatedAt: "2026-11-19T12:00:00Z",
    ...extra,
  } as unknown as Quote;
}

const unescape = (s: string) =>
  s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();

function heroOf(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  assert(m, "the quote email has an <h1> hero");
  return unescape(m[1]);
}
function preheaderOf(html: string): string {
  const m = html.match(
    /<span style="display:none!important[^>]*>([\s\S]*?)<\/span>/,
  );
  assert(m, "the quote email has a hidden preheader");
  return unescape(m[1]);
}
/** "Quote Q-001 from Reyes Remodeling — <job>" → "<job>" */
const subjectJob = (subject: string) => subject.split(" — ").at(-1)!.trim();

const CASES = [
  {
    lang: "en" as const,
    customer: "Maria Lopez",
    q: quote({
      lang: "en",
      customerSnapshot: { name: "Maria Lopez" },
      jobName: "Exterior Painting & Fence Staining",
      summary: "Exterior painting and fence staining — Maria Lopez",
    } as Partial<Quote>),
  },
  {
    lang: "es" as const,
    customer: "Lupe Garza",
    q: quote({
      lang: "es",
      customerSnapshot: { name: "Lupe Garza" },
      jobName: "Pintura exterior y tinte para cerca",
      jobNameByLang: { es: "Pintura exterior y tinte para cerca" },
      summary: "Pintura exterior y tinte para cerca — Lupe Garza",
    } as Partial<Quote>),
  },
];

for (const c of CASES) {
  const live = { name: c.customer };
  const html = () => renderQuoteHtml(c.q, live, marcus, biz(c.lang));
  const subject = () => renderQuoteSubject(c.q, marcus, biz(c.lang), live);
  const last = c.customer.split(" ")[1];

  Deno.test(
    `REQ-1087 (LOOP-007 q3, q3-4) ${c.lang}: the quote email's hero never carries the summary's '— ${c.customer}' tail`,
    () => {
      const hero = heroOf(html());
      assert(
        !hero.includes(last),
        `the hero names the customer: ${JSON.stringify(hero)}`,
      );
    },
  );

  Deno.test(
    `REQ-1087 (LOOP-007 q3, q3-4) ${c.lang}: the quote email's hero names the job exactly as the subject does`,
    () => {
      assertEquals(heroOf(html()), subjectJob(subject()));
    },
  );

  Deno.test(
    `REQ-1087 (LOOP-007 q3, q3-4) ${c.lang}: the preheader names the customer once ('… ${
      c.customer.split(" ")[0]
    } — <job> · $total', no '— ${c.customer}' tail)`,
    () => {
      const pre = preheaderOf(html());
      assert(
        !pre.includes(last),
        `the preheader repeats the customer's full name: ${
          JSON.stringify(pre)
        }`,
      );
      assert(
        pre.includes(subjectJob(subject())),
        `the preheader names the job as the subject does (${
          JSON.stringify(subjectJob(subject()))
        }): ${JSON.stringify(pre)}`,
      );
    },
  );
}

Deno.test(
  "REQ-1087 (LOOP-007 q3, q3-4) en: no capitalised 'And' in the hero (and/or/of/for stay lowercase)",
  () => {
    const hero = heroOf(
      renderQuoteHtml(CASES[0].q, { name: "Maria Lopez" }, marcus, biz("en")),
    );
    assert(!/\b(And|Or|Of|For)\b/.test(hero), `hero: ${JSON.stringify(hero)}`);
  },
);

Deno.test(
  "REQ-1087 (LOOP-007 q3, q3-4) en: a quote with no jobName falls back to the summary WITHOUT its '— <customer>' tail",
  () => {
    const q = quote({
      lang: "en",
      customerSnapshot: { name: "Maria Lopez" },
      summary: "Exterior painting and fence staining — Maria Lopez",
    } as Partial<Quote>);
    const html = renderQuoteHtml(q, { name: "Maria Lopez" }, marcus, biz("en"));
    const hero = heroOf(html);
    const pre = preheaderOf(html);
    assert(!hero.includes("Lopez"), `hero: ${JSON.stringify(hero)}`);
    assert(!pre.includes("Lopez"), `preheader: ${JSON.stringify(pre)}`);
  },
);
