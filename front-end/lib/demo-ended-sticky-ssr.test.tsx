/**
 * REQ-647 (demo-loop cycle 5, c2-p13-r) — /admin?demo=ended&by=… says who ended the demo on first
 * paint. Pairs 1 and 2 landed on /admin with the address still carrying `?demo=ended&by=you` and
 * no notice: the notice was set only in an effect, after hydration, so a page whose islands did
 * not hydrate (one stale island kills them all) never said it. Now _app reads the address on the
 * server and hands the island its `endedNotice`, which the server render paints.
 *
 *   cd front-end && deno test -A lib/demo-ended-ssr.test.tsx
 */
import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import DemoModeOverlay from "../islands/DemoModeOverlay.tsx";
import { adminEndedNotice } from "./demo-mode/pill-carry.ts";
import { langSignal } from "./lang.ts";

/** the server render in a given language (the live signal the request set) */
function inLang<T>(lang: "en" | "es", fn: () => T): T {
  const before = langSignal.value;
  langSignal.value = lang;
  try {
    return fn();
  } finally {
    langSignal.value = before;
  }
}

Deno.test("REQ-647 c2-p13-r: the overlay's server render paints 'You ended the demo' from its endedNotice prop", () => {
  const en = inLang(
    "en",
    () => renderToString(<DemoModeOverlay endedNotice={{ by: "you" }} />),
  );
  assert(en.includes('data-cy="demo-ended"'), en.slice(0, 400));
  assert(en.includes("You ended the demo"), en.slice(0, 600));
  const es = inLang(
    "es",
    () =>
      renderToString(
        <DemoModeOverlay endedNotice={{ by: "other", name: "Ana Torres" }} />,
      ),
  );
  assert(es.includes("Ana Torres terminó la demo"), es.slice(0, 600));
});

Deno.test("REQ-647 c2-p13-r: with no notice the server render is still empty", () => {
  assertEquals(renderToString(<DemoModeOverlay />), "");
});

Deno.test("REQ-647 c2-p13-r: adminEndedNotice reads /admin's handover address only", () => {
  assertEquals(adminEndedNotice("/admin", "?demo=ended&by=you"), {
    by: "you",
  });
  assertEquals(
    adminEndedNotice("/admin", "?demo=ended&by=other&name=Ana%20Torres"),
    { by: "other", name: "Ana Torres" },
  );
  assertEquals(adminEndedNotice("/dashboard", "?demo=ended&by=you"), null);
  assertEquals(adminEndedNotice("/admin", "?q=1"), null);
});
