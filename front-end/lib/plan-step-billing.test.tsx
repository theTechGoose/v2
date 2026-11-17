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
