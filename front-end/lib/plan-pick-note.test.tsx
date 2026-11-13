/**
 * REQ-356 — Raphael: "fix every issue the demo found, loop until there are none." Demo-loop
 * cycle 1, issue m8: "Picking a paid plan jumps to pay page with no amount, no trial, no confirm".
 *
 * RCA: a plan card IS the submit (components/PlanCards.tsx — a form posting /plan/pick, 303 to
 * the pay page), and REQ-127's `note` line — the ONE line saying what the pick does — was passed
 * by /settings only; the onboarding wizard's cards said nothing about what pressing one does.
 * The rule now: every card on the wizard's plan step carries that line before it is pressed —
 * a paid card its amount today, the monthly price after it, and that a secure payment page comes
 * next; the free card that nothing is paid. The amounts come from the one switch rule
 * (shared/quote-flow/plan-switch.ts), so the line can never promise one number and the CRM
 * charge another.
 *
 * Renders the real island (server side) at the plan step, in English and in Spanish.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import WelcomeWizard from "../islands/WelcomeWizard.tsx";
import type { ProfileSnapshot } from "../clients/profile.ts";
import { ONBOARDING_PLANS } from "../../shared/quote-flow/pricing-plans.ts";
import { dollars } from "../components/PlanCards.tsx";
import { wizardPlanNote } from "./plan-pick-note.ts";
import { langSignal } from "./lang.ts";
import { planById } from "../../shared/quote-flow/plan-switch.ts";

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

function noteTexts(lang: "en" | "es"): Map<string, string> {
  // the island's own seed runs in an effect (client only); server side it renders in the signal's language
  langSignal.value = lang;
  const html = renderToString(
    <WelcomeWizard snapshot={atPlanStep()} initialLang={lang} />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html")!;
  const out = new Map<string, string>();
  for (const p of ONBOARDING_PLANS) {
    const el = doc.querySelector(`[data-cy='plan-note-${p.id}']`);
    if (el) out.set(p.id, el.textContent.trim());
  }
  return out;
}

const paid = ONBOARDING_PLANS.filter((p) => p.priceCents > 0);

Deno.test("REQ-356: every paid card on the wizard's plan step says, before it is pressed, what is billed today, the monthly price, and that a secure payment page comes next (demo-loop c1 m8)", () => {
  assert(paid.length > 0, "the wizard offers paid plans");
  const notes = noteTexts("en");
  for (const p of paid) {
    const note = notes.get(p.id);
    assert(note, `the ${p.name} card carries a note (plan-note-${p.id})`);
    assertStringIncludes(note, `${dollars(p.priceCents)} today`, p.name);
    // REQ-725 (c5 m3) — the monthly price in the one plain line
    assertStringIncludes(
      note,
      `then ${dollars(p.priceCents)} on the 1st of each month`,
      p.name,
    );
    assertStringIncludes(note, "secure payment page", p.name);
  }
});

Deno.test("REQ-356: the free card says nothing is paid (demo-loop c1 m8)", () => {
  const note = noteTexts("en").get("free");
  assert(note, "the Monster Free card carries a note (plan-note-free)");
  assertStringIncludes(note, "nothing to pay");
});

Deno.test("REQ-356: the notes speak Spanish on a Spanish wizard (demo-loop c1 m8)", () => {
  const notes = noteTexts("es");
  for (const p of paid) {
    const note = notes.get(p.id);
    assert(note, `the ${p.name} card carries a Spanish note`);
    assertStringIncludes(note, `${dollars(p.priceCents)} hoy`, p.name);
    assertStringIncludes(
      note,
      `luego ${dollars(p.priceCents)} el día 1 de cada mes`,
      p.name,
    );
    assertStringIncludes(note, "página de pago segura", p.name);
  }
  assertStringIncludes(notes.get("free") ?? "", "nada que pagar");
});

Deno.test("REQ-356: the note's amounts come from the one switch rule — a pick still pending (nobody paid) is a first pick at full price (demo-loop c1 m8)", () => {
  // REQ-615 added the dated schedule's vars (plan-schedule-note.test.ts); this pins the amounts
  const t = (k: string, v?: Record<string, string | number>) =>
    `${k}${v ? JSON.stringify({ due: v.due, monthly: v.monthly }) : ""}`;
  const now = "2026-11-12T12:00:00.000Z";
  assertEquals(
    wizardPlanNote(t, { planId: "assist", status: "pending" }, "monster", now),
    `welcome.plan.note.paid{"due":"${
      dollars(planById("monster").priceCents)
    }","monthly":"${dollars(planById("monster").priceCents)}"}`,
  );
  assertEquals(
    wizardPlanNote(t, null, "free", now),
    "welcome.plan.note.free",
  );
});
