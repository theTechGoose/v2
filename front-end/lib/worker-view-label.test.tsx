/**
 * REQ-739 (demo-loop cycle 5, issue p18-3f) — the server render of the real
 * DashSidebar island does not hand out a /worker href that flips to
 * /field/workers after hydration: while the worker count is unknown the row
 * is a hidden placeholder with no href (it keeps its slot and its name, so the
 * rail does not jump and REQ-517's naming still holds).
 *
 *   cd front-end && deno test -A lib/worker-view-label.test.tsx
 */
import { assert } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.6.7";
import { langSignal } from "./i18n.ts";
import DashSidebar from "../islands/DashSidebar.tsx";

function workerRow(lang: "en" | "es"): string {
  const before = langSignal.value;
  langSignal.value = lang;
  try {
    const html = renderToString(<DashSidebar active="home" />);
    const row = html.match(/<a\b[^>]*data-cy="nav-worker-view"[^>]*>/)?.[0];
    assert(row, "the worker row renders on the server");
    return row;
  } finally {
    langSignal.value = before;
  }
}

Deno.test("REQ-739 (p18-3f): SSR — the worker row has no href until the count is known", () => {
  for (const lang of ["en", "es"] as const) {
    const row = workerRow(lang);
    assert(!/\bhref=/.test(row), `${lang}: no href on the placeholder: ${row}`);
    assert(/visibility:\s*hidden/.test(row), `${lang}: hidden: ${row}`);
    assert(/aria-hidden="true"/.test(row), `${lang}: aria-hidden: ${row}`);
  }
});
