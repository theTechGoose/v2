/**
 * REQ-257 — Raphael: "fix every issue the demo found." Demo issue
 * onboarding-dashboard-settings-p3: Enter does not submit the insurance step
 * (and the address step has the same gap).
 *
 * The wizard had no <form>: each step's inputs were loose and the footer's
 * Continue was a type="button", so the browser had no implicit Enter-to-submit
 * and only steps with a hand-written Enter handler moved on. The rule now:
 * every step's fields sit in a form whose default button is the footer's
 * Continue, so Enter in any field does what Continue does (and nothing while
 * Continue is disabled — the browser does not submit through a disabled
 * default button).
 *
 * Renders the real island (server side) at the insurance step and at the
 * address step and checks the HTML that drives implicit submission.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser, type Element } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import WelcomeWizard from "../islands/WelcomeWizard.tsx";
import type { ProfileSnapshot } from "../clients/profile.ts";

/** every onboarding question answered except the ones in `open` */
type Open = Array<"insurance" | "address" | "plan">;

function snapshotWith(open: Open): ProfileSnapshot {
  return {
    user: { id: "u1", name: "Story Person", email: "story@example.com" },
    identity: {
      userId: "u1",
      businessName: "Story Roofing LLC",
      logoFileId: "f1",
      acceptedPaymentMethods: { cash: { enabled: true } },
    },
    address: open.includes("address") ? { state: "TX" } : {
      state: "TX",
      street: "1600 Congress Ave",
      city: "Austin",
      postal: "78701",
    },
    insurance: open.includes("insurance") ? null : { provider: "State Farm" },
    tax: null,
    contractDefaults: null,
    references: [],
    plan: open.includes("plan") ? null : { planId: "free", status: "active" },
    initials: "SP",
  } as unknown as ProfileSnapshot;
}

function render(open: Open) {
  const html = renderToString(
    <WelcomeWizard snapshot={snapshotWith(open)} initialLang="en" />,
  );
  return new DOMParser().parseFromString(html, "text/html")!;
}

function formOf(el: Element): Element | null {
  let cur: Element | null = el.parentElement;
  while (cur && cur.tagName !== "FORM") cur = cur.parentElement;
  return cur;
}

/** the button the browser presses on Enter: the form's first submit button in tree order */
function defaultButton(form: Element): Element | null {
  for (const b of form.querySelectorAll("button")) {
    const type = (b.getAttribute("type") ?? "submit").toLowerCase();
    if (type === "submit") return b;
  }
  return null;
}

function assertEnterSubmits(
  open: Array<"insurance" | "address">,
  label: string,
) {
  const doc = render(open);
  const inputs = [
    ...doc.querySelectorAll(".welcome__step input.welcome__input"),
  ];
  assert(inputs.length > 0, `${label}: the step renders its text inputs`);
  const continueBtn = doc.querySelector("[data-cy='welcome-continue']");
  assert(continueBtn, `${label}: the step renders Continue`);
  for (const input of inputs) {
    const form = formOf(input);
    assert(
      form,
      `${label}: "${
        input.getAttribute("aria-label")
      }" sits in a <form>, so Enter submits it`,
    );
    assertEquals(
      defaultButton(form)?.getAttribute("data-cy"),
      "welcome-continue",
      `${label}: Enter in "${
        input.getAttribute("aria-label")
      }" presses Continue — not Back or Skip`,
    );
  }
}

Deno.test("REQ-257: Enter in the insurance step's fields presses Continue (demo onboarding-dashboard-settings-p3)", () => {
  assertEnterSubmits(["insurance"], "insurance step");
});

Deno.test("REQ-257: Enter in the address step's fields presses Continue (the same gap, demo onboarding-dashboard-settings-p3)", () => {
  assertEnterSubmits(["address"], "address step");
});

Deno.test("REQ-257: the plan step keeps its own plan-card forms un-nested — HTML drops a <form> inside a <form>, which would break the pick", () => {
  const doc = render(["plan"]);
  const forms = [...doc.querySelectorAll(".welcome__step form")];
  assert(forms.length > 0, "the plan step renders its plan-card forms");
  for (const f of forms) {
    assertEquals(
      formOf(f),
      null,
      "a plan card's form is not inside another form",
    );
  }
});
