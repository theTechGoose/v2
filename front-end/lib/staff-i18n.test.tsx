/**
 * REQ-269 (demo issue i18n-formatting-m2) — the staff side follows the app
 * language. In the 20-agent demo a Spanish super admin on /admin read
 * "Hola, Alex" over an English body ("Search users, grant or revoke admin,
 * and impersonate.", "Searching…", Grant/Revoke/Demo), an English
 * impersonation bar ("Impersonating … · Return to your account"), and a
 * footer that never followed the topbar's EN/ES toggle. These render the
 * real islands with preact-render-to-string under each language.
 *
 *   cd front-end && deno test -A lib/staff-i18n.test.tsx
 */
import { assert, assertEquals } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.6.7";
import { langSignal } from "./i18n.ts";
import AdminPage from "../islands/AdminPage.tsx";
import { ImpersonationBannerView } from "../components/ImpersonationBannerView.tsx";
import { liveLang } from "./live-lang.ts";

function withLang<T>(lang: "en" | "es", fn: () => T): T {
  const before = langSignal.value;
  langSignal.value = lang;
  try {
    return fn();
  } finally {
    langSignal.value = before;
  }
}

const ENGLISH_ADMIN = [
  "Search users, grant or revoke admin, and impersonate.",
  "Search by name, business or phone",
  "Search users by name, business or phone number",
  ">Users<",
  ">Accounts<",
  ">Search<",
  "No users found.",
];

Deno.test("REQ-269: /admin's body renders in Spanish when the app language is es — no English operator copy", () => {
  const html = withLang("es", () => renderToString(<AdminPage />));
  for (const s of ENGLISH_ADMIN) {
    assert(!html.includes(s), `English left in the Spanish /admin: ${s}`);
  }
  assert(html.includes("Buscar usuarios"), html);
  assert(html.includes(">Usuarios<"), "the Users tab reads Usuarios");
  assert(html.includes(">Cuentas<"), "the Accounts tab reads Cuentas");
  assert(html.includes(">Buscar<"), "the search button reads Buscar");
  // REQ-728 (cycle 5, m15): the first paint is the loading line, not the
  // empty state — it still speaks Spanish.
  assert(html.includes("Cargando usuarios…"), html);
});

Deno.test("REQ-269: /admin's body stays English when the app language is en", () => {
  const html = withLang("en", () => renderToString(<AdminPage />));
  assert(
    html.includes("Search users, grant or revoke admin, and impersonate."),
    html,
  );
  assert(html.includes(">Users<") && html.includes(">Accounts<"), html);
  // REQ-728 (cycle 5, m15): loading line on first paint, never "No users found."
  assert(html.includes("Loading users…"), html);
});

const who = {
  impersonating: true,
  user: { id: "u1", name: "Alex Rivera", phoneNumber: "+15125550100" },
  impersonator: { id: "a1", name: "Rafa" },
  // deno-lint-ignore no-explicit-any
} as any;

Deno.test("REQ-269: the impersonation bar speaks the app language", () => {
  const es = withLang(
    "es",
    () =>
      renderToString(
        <ImpersonationBannerView who={who} busy={false} onStop={() => {}} />,
      ),
  );
  assert(!/Impersonating|Return to your account|\(as /.test(es), es);
  assert(es.includes("Suplantando"), es);
  assert(es.includes("Alex Rivera"), es);
  assert(es.includes("Rafa"), es);
  assert(es.includes("Volver a tu cuenta"), es);
  const esBusy = withLang(
    "es",
    () =>
      renderToString(
        <ImpersonationBannerView who={who} busy onStop={() => {}} />,
      ),
  );
  assert(esBusy.includes("Volviendo…") && !esBusy.includes("Returning"));

  const en = withLang(
    "en",
    () =>
      renderToString(
        <ImpersonationBannerView who={who} busy={false} onStop={() => {}} />,
      ),
  );
  assert(en.includes("Impersonating"), en);
  assert(en.includes("Return to your account"), en);
});

Deno.test("REQ-269: the live footer renders the SSR language until hydrated, then follows langSignal", () => {
  withLang("es", () => {
    assertEquals(liveLang(false, "en"), "en", "SSR/first paint: the prop");
    assertEquals(liveLang(true, "en"), "es", "hydrated: the signal");
  });
  withLang("en", () => {
    assertEquals(liveLang(true, "es"), "en", "toggled to EN: English");
  });
});
