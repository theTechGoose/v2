/** REQ-151 — the welcome text a new worker gets: who added them, where to sign in, their PIN; in the owner's language. */
import { assert, assertEquals } from "#std/assert";
import { workerLang, workerWelcome } from "./mod.ts";

Deno.test("REQ-151 workerWelcome — English: the owner, the /worker address and the PIN, on one text", () => {
  const body = workerWelcome("en", {
    owner: "Raphael (Monster RG)",
    url: "https://documonster.com/worker",
    pin: "1234",
  });
  assertEquals(
    body,
    "Raphael (Monster RG) added you as a worker on DocuMonster. Sign in at https://documonster.com/worker with this number and your PIN 1234.",
  );
  assert(body.length <= 160, `one SMS segment: ${body.length}`);
});

Deno.test("REQ-151 workerWelcome — Spanish: the same three facts, in Spanish", () => {
  const body = workerWelcome("es", {
    owner: "Raphael (Monster RG)",
    url: "http://localhost:5280/worker",
    pin: "4321",
  });
  assertEquals(
    body,
    "Raphael (Monster RG) te agregó como trabajador en DocuMonster. Entra en http://localhost:5280/worker con este número y tu PIN 4321.",
  );
  assert(body.length <= 160, `one SMS segment: ${body.length}`);
});

Deno.test("REQ-155 workerLang — the worker's language, else the owner's, else en", () => {
  assertEquals(workerLang({ language: "en" }, { language: "es" }), "en");
  assertEquals(workerLang({ language: "es" }, { language: "en" }), "es");
  assertEquals(workerLang({}, { language: "es" }), "es");
  assertEquals(workerLang({}, {}), "en");
  assertEquals(workerLang({ language: undefined }, { language: "en" }), "en");
});
