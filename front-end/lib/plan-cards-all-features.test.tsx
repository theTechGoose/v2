/**
 * REQ-733 — demo-loop cycle 5, issues m17 + c1-m42. The plan lists now say what Free really has
 * (e-signatures, sending, payment tracking, change orders, workers — no plan gating exists), and
 * those lines sit after REQ-109's three on Monster Free. The onboarding and settings cards
 * (components/PlanCards.tsx) used to show only a plan's first three lines, which would hide every
 * one of them — so a crew owner at onboarding could not tell that Free has workers (REQ-515's
 * m53). The cards show a plan's whole list.
 */
import { assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { PlanCards } from "../components/PlanCards.tsx";
import { ONBOARDING_PLANS } from "../../shared/quote-flow/pricing-plans.ts";

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-733 the plan cards list every feature line of each plan (${lang})`, () => {
    const html = renderToString(
      <PlanCards
        plans={ONBOARDING_PLANS}
        lang={lang}
        disabled={() => false}
        back="/welcome"
      />,
    );
    const doc = new DOMParser().parseFromString(html, "text/html")!;
    for (const p of ONBOARDING_PLANS) {
      const items = [
        ...doc.querySelectorAll(
          `[data-cy="plan-pick-${p.id}"] .plan-card__features li`,
        ),
      ].map((li) => li.textContent);
      assertEquals(items, p.features.map((f) => lang === "es" ? f.es : f.en));
    }
  });
}
