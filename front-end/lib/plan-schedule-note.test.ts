/**
 * REQ-615 — Raphael: "fix every issue the demo found, loop until there are none." Demo-loop
 * cycle 4, issue m4: "Plan step confusing ($99 today · prorated on the 1st)" — 9 of 9 customers
 * asked "do I pay 99 today or less?".
 *
 * RCA: the paid plan note (`welcome.plan.note.paid`, and Settings' `billing.note.first`) said
 * "{due} today · prorated on the 1st · then {monthly}/month". The real first-pick schedule
 * (REQ-129, `anchoredSchedule` in shared/quote-flow/plan-switch.ts) is: the full month today,
 * paid through a month later; then on the next 1st a SECOND, prorated bill for the days of that
 * month past the paid-through date; then the full price every 1st. The note named neither the
 * prorated amount nor its date, so "prorated" read as describing today's charge.
 *
 * The rule now: a first-pick note states each charge with its date — what today pays and the
 * days it covers, the 1st's prorated amount and the days it covers, then the monthly price —
 * all from `anchoredSchedule`, the one rule the backend tells the CRM.
 *
 * REQ-725 (c5 m3) amends where the wizard says it: the card now carries one plain line, and the
 * dated schedule lives in the "How billing works" disclosure (`wizardBillingHow`,
 * `welcome.plan.billingHow.body`); Settings' `billing.note.first` is unchanged.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { tFor } from "./i18n.ts";
import { firstPickNote, wizardBillingHow } from "./plan-pick-note.ts";
import en from "../../lang/en.json" with { type: "json" };
import es from "../../lang/es.json" with { type: "json" };
import {
  anchoredSchedule,
  planById,
} from "../../shared/quote-flow/plan-switch.ts";

const NOW = "2026-11-12T12:00:00.000Z";
const monster = planById("monster").priceCents; // $99

Deno.test("REQ-615/REQ-725: the wizard's 'How billing works' states today's charge with the days it covers, the 1st's prorated bill with its amount and days, then the monthly price (demo-loop c4 m4)", () => {
  // anchoredSchedule: paid through Dec 12; Dec 1 bills Dec 12–31 = 20/31 of $99 = $63.87
  assertEquals(anchoredSchedule(NOW, monster).firstAmountCents, 6387);
  const t = (k: string, v?: Record<string, string | number>) =>
    tFor("en", k, v);
  assertEquals(
    wizardBillingHow(t, "monster", NOW, "en"),
    "Example with Monster ($99/month), picked today: $99 today covers Nov 12–Dec 11. To line your bill up with the 1st, on Dec 1 we bill $63.87 for Dec 12–Dec 31. After that, $99 on the 1st of each month. Other plans work the same way at their price.",
  );
});

Deno.test("REQ-615: the same schedule in Spanish (demo-loop c4 m4)", () => {
  const t = (k: string, v?: Record<string, string | number>) =>
    tFor("es", k, v);
  assertEquals(
    wizardBillingHow(t, "monster", NOW, "es"),
    "Ejemplo con Monster ($99/mes), elegido hoy: $99 hoy cubre 12 nov–11 dic. Para alinear tu cobro con el día 1, el 1 dic cobramos $63.87 por 12 dic–31 dic. Después, $99 el día 1 de cada mes. Los demás planes funcionan igual con su precio.",
  );
});

Deno.test("REQ-615: a pick on the 1st — today covers the month, the next 1st is the full price (demo-loop c4 m4)", () => {
  const t = (k: string, v?: Record<string, string | number>) =>
    tFor("en", k, v);
  assertEquals(
    wizardBillingHow(t, "monster", "2026-11-01T09:00:00.000Z", "en"),
    "Example with Monster ($99/month), picked today: $99 today covers Nov 1–Nov 30. To line your bill up with the 1st, on Dec 1 we bill $99 for Dec 1–Dec 31. After that, $99 on the 1st of each month. Other plans work the same way at their price.",
  );
});

Deno.test("REQ-615: Settings' first-pick note says the same dated schedule (demo-loop c4 m4)", () => {
  const t = (k: string, v?: Record<string, string | number>) =>
    tFor("en", k, v);
  assertEquals(
    firstPickNote(t, "billing.note.first", monster, NOW, "en"),
    "$99 today (covers Nov 12–Dec 11) · Dec 1: $63.87 for Dec 12–Dec 31 · then $99/month on the 1st",
  );
  const settings = Deno.readTextFileSync(
    new URL("../islands/SettingsPage.tsx", import.meta.url),
  );
  assertStringIncludes(settings, "firstPickNote(");
  assertStringIncludes(settings, '"billing.note.first"');
});

Deno.test("REQ-615: no plan note says 'prorated on the 1st' without the amount and date (demo-loop c4 m4)", () => {
  for (const d of [en, es] as Record<string, string>[]) {
    for (const k of ["welcome.plan.billingHow.body", "billing.note.first"]) {
      const s = d[k];
      assert(!/prorated on the 1st|prorrateado el día 1/.test(s), `${k}: ${s}`);
      for (
        const v of [
          "{due}",
          "{from}",
          "{to}",
          "{billDate}",
          "{prorated}",
          "{proFrom}",
          "{proTo}",
          "{monthly}",
        ]
      ) {
        if (v === "{due}") continue; // the schedule starts at the full {monthly}
        assertStringIncludes(s, v, `${k} names ${v}`);
      }
    }
  }
});
