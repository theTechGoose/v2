/**
 * REQ-725 — Raphael: "fix every issue the demo found, loop until there are none." Demo-loop
 * cycle 5, issue m3: "Plan step billing line confuses; clicking a plan card skips Continue".
 *
 * RCA: REQ-615 printed the whole anchored schedule (REQ-129) on each paid card — "$99 today
 * (covers Nov 12–Dec 11) · Dec 1: $63.87 for Dec 12–Dec 31 · then …" — which reads as a double
 * charge; and each card is a submit (PlanCards.tsx), yet PlanStep still drew a disabled Continue.
 * The rule now: one plain line on the card, the dated schedule behind "How billing works", and no
 * Continue under the cards while nothing is settled.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import WelcomeWizard from "../islands/WelcomeWizard.tsx";
import type { ProfileSnapshot } from "../clients/profile.ts";
import { ONBOARDING_PLANS } from "../../shared/quote-flow/pricing-plans.ts";
import { tFor } from "./i18n.ts";
import { langSignal } from "./lang.ts";
import { wizardBillingHow, wizardPlanNote } from "./plan-pick-note.ts";
import { anchoredSchedule } from "../../shared/quote-flow/plan-switch.ts";

const NOW = "2026-11-12T12:00:00.000Z";
const en = (k: string, v?: Record<string, string | number>) => tFor("en", k, v);
const es = (k: string, v?: Record<string, string | number>) => tFor("es", k, v);

Deno.test("REQ-725: a paid card's note is one plain line — today, then the monthly price on the 1st (demo-loop c5 m3)", () => {
  assertEquals(
    wizardPlanNote(en, null, "monster", NOW, "en"),
    "$99 today, then $99 on the 1st of each month — you'll pay on a secure payment page next",
  );
  assertEquals(
    wizardPlanNote(es, null, "monster", NOW, "es"),
    "$99 hoy, luego $99 el día 1 de cada mes — pagarás en una página de pago segura a continuación",
  );
});

Deno.test("REQ-725: 'How billing works' spells out the dated schedule from anchoredSchedule (demo-loop c5 m3)", () => {
  assertEquals(
    wizardBillingHow(en, "monster", NOW, "en"),
    "Example with Monster ($99/month), picked today: $99 today covers Nov 12–Dec 11. To line your bill up with the 1st, on Dec 1 we bill $63.87 for Dec 12–Dec 31. After that, $99 on the 1st of each month. Other plans work the same way at their price.",
  );
  assertEquals(
    wizardBillingHow(es, "monster", NOW, "es"),
    "Ejemplo con Monster ($99/mes), elegido hoy: $99 hoy cubre 12 nov–11 dic. Para alinear tu cobro con el día 1, el 1 dic cobramos $63.87 por 12 dic–31 dic. Después, $99 el día 1 de cada mes. Los demás planes funcionan igual con su precio.",
  );
});

function atPlanStep(): ProfileSnapshot {
  return {
    user: { id: "u1", name: "Story Person", email: "story@example.com" },
    identity: {
      userId: "u1",
      businessName: "Story Roofing LLC",
      logoFileId: "f1",
      acceptedPaymentMethods: { cash: { enabled: true } },
    },
    address: {
      state: "TX",
      street: "1600 Congress Ave",
      city: "Austin",
      postal: "78701",
    },
    insurance: { provider: "State Farm" },
    tax: null,
    contractDefaults: null,
    references: [],
    plan: null,
    initials: "SP",
  } as unknown as ProfileSnapshot;
}

function render(lang: "en" | "es") {
  langSignal.value = lang;
  const html = renderToString(
    <WelcomeWizard snapshot={atPlanStep()} initialLang={lang} />,
  );
  return new DOMParser().parseFromString(html, "text/html")!;
}

const paid = ONBOARDING_PLANS.filter((p) => p.priceCents > 0);

Deno.test("REQ-725 rendered: the plan step's paid notes are the one line, the dated schedule sits in a closed 'How billing works' disclosure, and no Continue shows under the cards (demo-loop c5 m3)", () => {
  const doc = render("en");
  assert(
    doc.querySelector("[data-cy='plan-pick-monster']"),
    "at the plan step, cards showing",
  );
  for (const p of paid) {
    const note =
      doc.querySelector(`[data-cy='plan-note-${p.id}']`)?.textContent ?? "";
    assertStringIncludes(note, "on the 1st of each month", p.name);
    assert(
      !/covers|·/.test(note),
      `${p.name}: no dated schedule on the card (${note})`,
    );
  }
  const how = doc.querySelector("details[data-cy='plan-billing-how']");
  assert(how, "a 'How billing works' disclosure under the cards");
  assert(!how.hasAttribute("open"), "closed until asked");
  assertEquals(
    how.querySelector("summary")?.textContent.trim(),
    "How billing works",
  );
  assertStringIncludes(how.textContent, "To line your bill up with the 1st");
  assertEquals(
    doc.querySelectorAll("[data-cy='welcome-continue']").length,
    0,
    "a card IS the pick: no Continue under the cards",
  );
  assert(doc.querySelector("[data-cy='welcome-skip']"), "Skip stays");
});

Deno.test("REQ-725 rendered: the disclosure speaks Spanish on a Spanish wizard (demo-loop c5 m3)", () => {
  const how = render("es").querySelector("details[data-cy='plan-billing-how']");
  assertEquals(
    how?.querySelector("summary")?.textContent.trim(),
    "Cómo funciona el cobro",
  );
});

/* REQ-970 (LOOP-007 cycle 1, q1-51) — the card line "$99 today, then $99 on the 1st of each
 * month" names the full price for the NEXT 1st, while the real first-pick schedule (REQ-129,
 * `anchoredSchedule`) bills a prorated catch-up there ($44.71 for a Nov 18 Monster pick), and the
 * "How billing works" body under the same cards says so. The rule: a paid card's note never
 * promises {monthly} on the next 1st unless that bill IS {monthly} — it names the catch-up amount,
 * or the date the full monthly price starts. */

const Q151_NOW = "2026-11-18T15:00:00.000Z";

function cash(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** the 1st after the schedule's first bill — when the full monthly price starts ("Jan 1") */
function steadyFrom(firstBillAt: string, lang: "en" | "es"): string {
  const d = new Date(firstBillAt);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    .toLocaleDateString(lang === "es" ? "es-MX" : "en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
}

/** what a paid card's note must do when the next 1st's bill is not the full price: name that
 *  bill's amount or the date the full price begins */
function assertNoteTellsTheNextFirst(
  note: string,
  monthlyCents: number,
  now: string,
  lang: "en" | "es",
  label: string,
) {
  const s = anchoredSchedule(now, monthlyCents);
  if (s.firstAmountCents === monthlyCents) return; // the next 1st IS the full price
  const prorated = cash(s.firstAmountCents);
  const from = steadyFrom(s.firstBillAt, lang);
  assert(
    note.includes(prorated) || note.includes(from),
    `${label}: the next 1st bills ${prorated}, not ${
      cash(monthlyCents)
    } — the card must name ${prorated} or that ${
      cash(monthlyCents)
    } starts ${from}; it says "${note}"`,
  );
}

Deno.test("REQ-970 (q1-51): a Nov 18 Monster pick's card note does not promise $99 on Dec 1 — anchoredSchedule bills $44.71 there", () => {
  const s = anchoredSchedule(Q151_NOW, 9900);
  assertEquals(s.firstBillAt.slice(0, 10), "2026-12-01", "the next 1st");
  assertEquals(
    s.firstAmountCents,
    4471,
    "the next 1st is the prorated catch-up",
  );
  assertNoteTellsTheNextFirst(
    wizardPlanNote(en, null, "monster", Q151_NOW, "en") ?? "",
    9900,
    Q151_NOW,
    "en",
    "Monster (en)",
  );
  assertNoteTellsTheNextFirst(
    wizardPlanNote(es, null, "monster", Q151_NOW, "es") ?? "",
    9900,
    Q151_NOW,
    "es",
    "Monster (es)",
  );
});

Deno.test("REQ-970 (q1-51): every paid onboarding card's note agrees with anchoredSchedule on the next 1st", () => {
  for (const p of paid) {
    assertNoteTellsTheNextFirst(
      wizardPlanNote(en, null, p.id, Q151_NOW, "en") ?? "",
      p.priceCents,
      Q151_NOW,
      "en",
      p.name,
    );
  }
});

Deno.test("REQ-970 (q1-51) rendered: on the wizard's plan step each paid card's note agrees with the 'How billing works' body on what the next 1st costs", () => {
  const now = new Date().toISOString(); // the wizard renders at the real clock
  const doc = render("en");
  const how =
    doc.querySelector("details[data-cy='plan-billing-how']")?.textContent ?? "";
  const monster = anchoredSchedule(now, 9900);
  if (monster.firstAmountCents !== 9900) {
    assertStringIncludes(
      how,
      `we bill ${cash(monster.firstAmountCents)}`,
      "the disclosure names the prorated next 1st",
    );
  }
  for (const p of paid) {
    const note =
      doc.querySelector(`[data-cy='plan-note-${p.id}']`)?.textContent ?? "";
    assertNoteTellsTheNextFirst(note, p.priceCents, now, "en", p.name);
  }
});
