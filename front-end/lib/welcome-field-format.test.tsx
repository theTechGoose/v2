/**
 * REQ-352 (demo-loop cycle 1, demo M38) — the onboarding wizard took ZIP
 * "7870". Renders the real island (server side) at the address step with a
 * stored four-digit ZIP: the step names the problem in-app, flags the field
 * and keeps Continue disabled.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import WelcomeWizard from "../islands/WelcomeWizard.tsx";
import type { ProfileSnapshot } from "../clients/profile.ts";
import { langSignal } from "../lib/lang.ts";

function addressStepWith(postal: string) {
  const snapshot = {
    user: { id: "u1", name: "Story Person", email: "story@example.com" },
    identity: {
      userId: "u1",
      businessName: "Story Roofing LLC",
      logoFileId: "f1",
      acceptedPaymentMethods: { cash: { enabled: true } },
    },
    address: { state: "TX", postal },
    insurance: { provider: "State Farm" },
    tax: null,
    contractDefaults: null,
    references: [],
    plan: { planId: "free", status: "active" },
    initials: "SP",
  } as unknown as ProfileSnapshot;
  langSignal.value = "en";
  const html = renderToString(
    <WelcomeWizard snapshot={snapshot} initialLang="en" />,
  );
  return new DOMParser().parseFromString(html, "text/html")!;
}

Deno.test("REQ-352 M38: a four-digit ZIP is named in-app, flagged and holds Continue", () => {
  const doc = addressStepWith("7870");
  const zip = doc.querySelector("input.welcome__input--zip");
  assert(zip, "the address step renders the ZIP field");
  assertEquals(zip.getAttribute("aria-invalid"), "true", "the ZIP is flagged");
  const msgId = zip.getAttribute("aria-describedby");
  assert(msgId, "the ZIP names its message");
  const msg = doc.getElementById(msgId);
  assert(
    msg?.textContent.includes("Enter a 5-digit ZIP"),
    `the message says what a ZIP is (${msg?.textContent})`,
  );
  assert(
    doc.querySelector("[data-cy='welcome-continue']")?.hasAttribute("disabled"),
    "Continue is disabled on a bad ZIP",
  );
});

Deno.test("REQ-352 M38: a five-digit ZIP passes", () => {
  const doc = addressStepWith("78701");
  const zip = doc.querySelector("input.welcome__input--zip");
  assert(zip);
  assertEquals(zip.getAttribute("aria-invalid"), null);
  assertEquals(
    doc.querySelector("[data-cy='welcome-continue']")?.hasAttribute(
      "disabled",
    ),
    false,
  );
});
