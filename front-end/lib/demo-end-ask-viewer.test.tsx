/**
 * REQ-649 — demo-loop cycle 5, issue m64: "Customer is asked 'End for everyone?'".
 * One EndDemo is drawn on the staff stage and in the customer's pill, and its question was always
 * `demoMode.endAsk` ("End for everyone?"), written for a presenter among several staff. The
 * customer has no "everyone": from their side End ends the demo with the person guiding them.
 * EndDemo now takes the question's key (and its vars) from the caller; the customer's pill asks
 * `demoMode.endAskViewer` ("End the demo with {name}?") and the stage keeps `demoMode.endAsk`.
 *
 *   cd front-end && deno test -A lib/demo-end-ask-viewer.test.tsx
 */
import { assert, assertEquals } from "@std/assert";
import { tFor } from "./i18n.ts";
import { endDemoWords } from "../components/demo-mode/EndDemo.tsx";

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, ROOT));

Deno.test("REQ-649 (m64): the viewer's question names the guide — en 'End the demo with Alex?', es '¿Terminar la demo con Alex?'", () => {
  assertEquals(
    tFor("en", "demoMode.endAskViewer", { name: "Alex" }),
    "End the demo with Alex?",
  );
  assertEquals(
    tFor("es", "demoMode.endAskViewer", { name: "Alex" }),
    "¿Terminar la demo con Alex?",
  );
});

Deno.test("REQ-649 (m64): EndDemo asks the caller's question; with none it keeps 'End for everyone?'", () => {
  const en = (k: string, v?: Record<string, string | number>) =>
    tFor("en", k, v);
  assertEquals(endDemoWords(en).ask, "End for everyone?");
  const viewer = endDemoWords(en, {
    askKey: "demoMode.endAskViewer",
    askVars: { name: "Alex" },
  });
  assertEquals(viewer.ask, "End the demo with Alex?");
  assert(!/everyone/i.test(viewer.ask), viewer.ask);
});

Deno.test("REQ-649 (m64): the customer's pill asks endAskViewer with the guide's name; the stage keeps endAsk", () => {
  const overlay = read("islands/DemoModeOverlay.tsx");
  const tag = overlay.match(/<EndDemo\b[\s\S]*?\/>/)?.[0] ?? "";
  assert(
    /askKey="demoMode\.endAskViewer"/.test(tag),
    `overlay EndDemo: ${tag}`,
  );
  assert(/askVars=\{\{\s*name:\s*names\s*\}\}/.test(tag), tag);
  const stage = read("islands/DemoStage.tsx");
  const stageTag = stage.match(/<EndDemo\b[\s\S]*?\/>/)?.[0] ?? "";
  assert(stageTag.length > 0, "stage draws EndDemo");
  assert(!/askKey=/.test(stageTag), `stage EndDemo: ${stageTag}`);
});
