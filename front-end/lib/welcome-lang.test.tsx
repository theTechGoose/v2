/**
 * REQ-348 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 1, issue m34: no EN/ES toggle in onboarding, and
 * "Languages you send in" defaulted to English alone for a contractor who
 * signed up from the Spanish landing page.
 *
 * Renders the real island (server side):
 *   - the wizard carries an EN/ES switch in its header, the account's
 *     language pressed (the same control as the dashboard topbar's);
 *   - the business-name step shows "Languages you send in" with the set the
 *     account will send in — English AND Spanish for a Spanish signup,
 *     English alone for an English one, a stored pick as stored.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import WelcomeWizard from "../islands/WelcomeWizard.tsx";
import type { ProfileSnapshot } from "../clients/profile.ts";
import { langSignal } from "./lang.ts";

function snapshotFor(
  language: "en" | "es",
  identity: Record<string, unknown> | null = null,
): ProfileSnapshot {
  return {
    user: { id: "u1", name: "Rafa Morales", language },
    identity,
    address: null,
    insurance: null,
    tax: null,
    contractDefaults: null,
    references: [],
    plan: null,
    initials: "RM",
  } as unknown as ProfileSnapshot;
}

function render(snap: ProfileSnapshot, lang: "en" | "es") {
  langSignal.value = lang;
  const html = renderToString(
    <WelcomeWizard snapshot={snap} initialLang={lang} />,
  );
  return new DOMParser().parseFromString(html, "text/html")!;
}

function checked(doc: ReturnType<typeof render>): string[] {
  return [...doc.querySelectorAll("[data-cy^='welcome-comms-']")]
    .filter((el) => el.hasAttribute("checked"))
    .map((el) => el.getAttribute("data-cy")!.replace("welcome-comms-", ""));
}

Deno.test("REQ-348: the onboarding wizard has an EN/ES switch, the account's language pressed (demo m34)", () => {
  for (const lang of ["en", "es"] as const) {
    const doc = render(snapshotFor(lang), lang);
    const group = doc.querySelector(".welcome__lang[role='group']");
    assert(group, `${lang}: the wizard renders a language switch`);
    const en = doc.querySelector("[data-cy='welcome-lang-en']");
    const es = doc.querySelector("[data-cy='welcome-lang-es']");
    assert(en && es, `${lang}: both EN and ES buttons`);
    assertEquals(en.getAttribute("aria-pressed"), String(lang === "en"));
    assertEquals(es.getAttribute("aria-pressed"), String(lang === "es"));
  }
});

Deno.test("REQ-348: the business step shows the languages you send in — English and Spanish for a Spanish signup (demo m34)", () => {
  const es = render(snapshotFor("es"), "es");
  assert(
    es.body.textContent.includes("Idiomas para enviar"),
    "the business step names the send-in languages",
  );
  assertEquals(checked(es), ["en", "es"]);
  assertEquals(checked(render(snapshotFor("en"), "en")), ["en"]);
  // a stored pick shows as stored
  assertEquals(
    checked(
      render(snapshotFor("es", { userId: "u1", commsLanguages: ["es"] }), "es"),
    ),
    ["es"],
  );
});
