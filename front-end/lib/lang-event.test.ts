/**
 * REQ-345 — demo-loop cycle 1, issues m3 + p15-6: the landing page's EN/ES
 * toggle (static/landing-scripts.js, a plain script outside the island bundle)
 * could not reach langSignal, so the PhoneChat island stayed Spanish on
 * /?lang=en until a reload. The bridge: the toggle dispatches a `pm:lang`
 * CustomEvent on document and lang.ts turns it into langSignal.
 */
import { assertEquals } from "@std/assert";
import { LANG_EVENT, langSignal, listenForLangEvents } from "./lang.ts";

Deno.test("REQ-345 a pm:lang CustomEvent flips langSignal", () => {
  const target = new EventTarget();
  const off = listenForLangEvents(target);
  langSignal.value = "es";
  target.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: "en" }));
  assertEquals(langSignal.value, "en", "EN event → langSignal en");
  target.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: "es" }));
  assertEquals(langSignal.value, "es", "ES event → langSignal es");
  off();
  target.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: "en" }));
  assertEquals(langSignal.value, "es", "unsubscribed: the signal stays");
});

Deno.test("REQ-345 an invalid pm:lang detail is ignored", () => {
  const target = new EventTarget();
  const off = listenForLangEvents(target);
  langSignal.value = "es";
  target.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: "fr" }));
  target.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: { x: 1 } }));
  target.dispatchEvent(new Event(LANG_EVENT));
  assertEquals(langSignal.value, "es");
  off();
});

Deno.test("REQ-345 the event name the landing toggle dispatches is pm:lang", () => {
  assertEquals(LANG_EVENT, "pm:lang");
});
