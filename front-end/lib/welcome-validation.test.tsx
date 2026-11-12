/**
 * REQ-390 (demo-loop cycle 2, demo m18) — onboarding blocked silently: a
 * business name of only spaces disabled Continue with no word why, and
 * unticking the last "send in" language left the box unticked on screen while
 * the old language was saved. Renders the real island server side at the
 * business-name step.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import WelcomeWizard from "../islands/WelcomeWizard.tsx";
import type { ProfileSnapshot } from "../clients/profile.ts";
import { langSignal } from "../lib/lang.ts";

function businessStepWith(
  identity: Record<string, unknown>,
  lang: "en" | "es" = "en",
) {
  const snapshot = {
    user: {
      id: "u1",
      name: "Story Person",
      email: "story@example.com",
      language: lang,
    },
    identity: { userId: "u1", ...identity },
    address: null,
    insurance: null,
    tax: null,
    contractDefaults: null,
    references: [],
    plan: null,
    initials: "SP",
  } as unknown as ProfileSnapshot;
  langSignal.value = lang;
  const html = renderToString(
    <WelcomeWizard snapshot={snapshot} initialLang={lang} />,
  );
  return new DOMParser().parseFromString(html, "text/html")!;
}

Deno.test("REQ-390 m18: a business name of only spaces says why Continue is off", () => {
  const doc = businessStepWith({ businessName: "   " });
  const input = doc.querySelector(
    'input[aria-label="What\'s your business called?"]',
  );
  assert(input, "the business-name step renders");
  assert(
    doc.querySelector("[data-cy='welcome-continue']")?.hasAttribute("disabled"),
    "Continue is off",
  );
  const msgId = input.getAttribute("aria-describedby");
  assert(msgId, "the field names its message");
  const msg = doc.getElementById(msgId)?.textContent ?? "";
  assert(/spaces/i.test(msg), `the message says spaces don't count (${msg})`);
});

Deno.test("REQ-390 m18: the one language left on cannot be unticked, and says so", () => {
  const doc = businessStepWith({
    businessName: "",
    commsLanguages: ["en"],
  });
  const enBox = doc.querySelector("[data-cy='welcome-comms-en']");
  const esBox = doc.querySelector("[data-cy='welcome-comms-es']");
  assert(enBox && esBox, "both language boxes render");
  assert(enBox.hasAttribute("checked"), "English is on");
  assert(enBox.hasAttribute("disabled"), "the last language on is locked");
  assertEquals(
    esBox.hasAttribute("disabled"),
    false,
    "Spanish can still be added",
  );
  const hint = doc.querySelector("[data-cy='welcome-comms-keep-one']");
  assert(
    hint && /at least one/i.test(hint.textContent),
    `a hint says why (${hint?.textContent})`,
  );
});

Deno.test("REQ-390 m18: with both languages on, neither is locked and no hint shows", () => {
  const doc = businessStepWith({
    businessName: "",
    commsLanguages: ["en", "es"],
  });
  assertEquals(
    doc.querySelector("[data-cy='welcome-comms-en']")?.hasAttribute(
      "disabled",
    ),
    false,
  );
  assertEquals(
    doc.querySelector("[data-cy='welcome-comms-keep-one']"),
    null,
  );
});
