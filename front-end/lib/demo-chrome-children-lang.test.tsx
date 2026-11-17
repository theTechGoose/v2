/**
 * REQ-544 — demo-loop cycle 4, issue m49: "Worker sign-in turns the owner's
 * browser and the demo pill Spanish ('… Connected · [Terminar demo]')".
 * REQ-494 routed the overlay's OWN strings through demoChromeLang, but the
 * pill's children — EndDemo (End, its question, both answers) and
 * PresenterChips ("(you)") — still read the global t(), i.e. the live
 * langSignal that REQ-285 sets to the signed-in worker's language on /worker.
 * Now both take the caller's `t`: the overlay hands them its chrome t.
 *
 *   cd front-end && deno test -A lib/demo-chrome-children-lang.test.tsx
 */
import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { langSignal } from "./lang.ts";
import { tFor } from "./i18n.ts";
import { demoChromeT } from "./demo-chrome-t.ts";
import EndDemo, { endDemoWords } from "../components/demo-mode/EndDemo.tsx";
import PresenterChips from "../components/demo-mode/PresenterChips.tsx";

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, ROOT));

/** The owner's browser (stored "en") on /worker after a worker signed in in Spanish. */
function onWorkerSignedInSpanish<T>(fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const before = {
    lang: langSignal.value,
    location: Object.getOwnPropertyDescriptor(globalThis, "location"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    stored: globalThis.localStorage.getItem("pm:lang"),
  };
  Object.defineProperty(globalThis, "location", {
    value: { pathname: "/worker" },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: { cookie: "" },
    configurable: true,
    writable: true,
  });
  globalThis.localStorage.setItem("pm:lang", "en");
  langSignal.value = "es";
  try {
    return fn();
  } finally {
    langSignal.value = before.lang;
    if (before.stored === null) globalThis.localStorage.removeItem("pm:lang");
    else globalThis.localStorage.setItem("pm:lang", before.stored);
    for (const k of ["location", "document"] as const) {
      const d = before[k];
      if (d) Object.defineProperty(globalThis, k, d);
      else delete g[k];
    }
  }
}

Deno.test("REQ-544 (m49): on /worker with langSignal 'es' and stored 'en', End and its confirm speak English", () => {
  onWorkerSignedInSpanish(() => {
    assertEquals(endDemoWords(demoChromeT), {
      end: tFor("en", "demoMode.end"),
      ask: tFor("en", "demoMode.endAsk"),
      yes: tFor("en", "demoMode.endYes"),
      no: tFor("en", "demoMode.endNo"),
    });
    const html = renderToString(<EndDemo t={demoChromeT} onEnd={() => {}} />);
    assert(html.includes(tFor("en", "demoMode.end")), html);
    assert(!html.includes(tFor("es", "demoMode.end")), html);
  });
});

Deno.test("REQ-544 (m49): on /worker with langSignal 'es' and stored 'en', the caller's chip says (you)", () => {
  onWorkerSignedInSpanish(() => {
    const html = renderToString(
      <PresenterChips
        t={demoChromeT}
        me="u1"
        presenters={[{ userId: "u1", name: "Alex", color: "#f00" }] as never}
      />,
    );
    assert(html.includes(`(${tFor("en", "demoMode.you")})`), html);
    assert(!html.includes(`(${tFor("es", "demoMode.you")})`), html);
  });
});

Deno.test("REQ-544 (m49): EndDemo and PresenterChips never read the global t; the overlay hands them its chrome t", () => {
  for (const f of ["EndDemo.tsx", "PresenterChips.tsx"]) {
    const src = read(`components/demo-mode/${f}`);
    assert(
      !/import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*"[^"]*i18n\.ts"/.test(src),
      f,
    );
  }
  const overlay = read("islands/DemoModeOverlay.tsx");
  assert(/<EndDemo\b[^>]*\bt=\{t\}/.test(overlay), "overlay EndDemo gets t");
  assert(
    /<PresenterChips\b[^>]*\bt=\{t\}/.test(overlay),
    "overlay chips get t",
  );
  assert(/demoChromeT/.test(overlay), "overlay's t is the chrome t");
  const stage = read("islands/DemoStage.tsx");
  assert(/<EndDemo\b[^>]*\bt=\{t\}/.test(stage), "stage EndDemo gets t");
  assert(/<PresenterChips\b[^>]*\bt=\{t\}/.test(stage), "stage chips get t");
});
