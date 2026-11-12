/**
 * REQ-494 — demo-loop cycle 3, issue M43 ("Worker view forgets English; worker
 * sign-in turns the owner's UI and demo pill Spanish").
 *
 * (1) An EN/ES pick made on /worker is remembered under its own cookie
 *     (pm_worker_lang), so re-opening /worker from the sidebar (no ?lang=)
 *     counts it as chosen and the signed-in worker's language does not undo it.
 * (2) On /worker the demo chrome (DemoModeOverlay's pill) speaks the viewer's
 *     stored language, not the worker's session language.
 */
import { assertEquals } from "@std/assert";
import {
  WORKER_LANG_COOKIE,
  workerLangPickFromCookie,
  workerRouteLang,
  workerScreenLang,
} from "./field.ts";
import { demoChromeLang } from "./lang.ts";

Deno.test("REQ-494 the /worker pick has its own cookie, read from a Cookie header", () => {
  assertEquals(WORKER_LANG_COOKIE, "pm_worker_lang");
  assertEquals(workerLangPickFromCookie("pm_lang=en; pm_worker_lang=en"), "en");
  assertEquals(workerLangPickFromCookie("pm_worker_lang=es"), "es");
  // HTTP/2 re-joined headers use ", "
  assertEquals(
    workerLangPickFromCookie("pm_session=x, pm_worker_lang=en, pm_lang=es"),
    "en",
  );
  assertEquals(workerLangPickFromCookie("pm_lang=en"), null);
  assertEquals(workerLangPickFromCookie("xpm_worker_lang=en"), null);
  assertEquals(workerLangPickFromCookie(null), null);
});

Deno.test("REQ-494 M43: re-entering /worker (no ?lang=) after picking EN keeps EN as chosen", () => {
  const r = workerRouteLang({ query: null, picked: "en", stored: "en" });
  assertEquals(r, { lang: "en", chosen: false, picked: true });
  // so the signed-in Spanish worker's language does not override it
  assertEquals(
    workerScreenLang({ language: "es" }, r.chosen || r.picked),
    null,
  );
});

Deno.test("REQ-494 workerRouteLang — ?lang= > the /worker pick > pm_lang > es", () => {
  assertEquals(workerRouteLang({ query: "es", picked: "en", stored: "en" }), {
    lang: "es",
    chosen: true,
    picked: true,
  });
  assertEquals(workerRouteLang({ query: null, picked: null, stored: "en" }), {
    lang: "en",
    chosen: false,
    picked: false,
  });
  assertEquals(workerRouteLang({ query: "fr", picked: null, stored: null }), {
    lang: "es",
    chosen: false,
    picked: false,
  });
});

Deno.test("REQ-494 M43: on /worker the demo pill keeps the viewer's stored language", () => {
  assertEquals(
    demoChromeLang({ path: "/worker", live: "es", stored: "en" }),
    "en",
  );
  assertEquals(
    demoChromeLang({ path: "/worker/", live: "es", stored: "en" }),
    "en",
  );
  // nothing stored: the page's language
  assertEquals(
    demoChromeLang({ path: "/worker", live: "es", stored: null }),
    "es",
  );
  // every other page follows the live language
  assertEquals(
    demoChromeLang({ path: "/dashboard", live: "es", stored: "en" }),
    "es",
  );
  assertEquals(
    demoChromeLang({ path: "/workers", live: "es", stored: "en" }),
    "es",
  );
});
