/**
 * REQ-416 — demo-loop cycle 2, issue p13-n ("Worker sign-in stays Spanish
 * after 'Salir'"): the worker screen applies the signed-in worker's language
 * for that session only. `setLang(l, { persist: false })` flips the signal and
 * <html lang> but leaves the browser's stored choice (pm:lang + pm_lang) alone;
 * plain `setLang(l)` still persists (Settings, the EN/ES switch).
 */
import { assertEquals } from "@std/assert";
import { langSignal, setLang } from "./i18n.ts";

type G = Record<string, unknown>;

function fakeBrowser(stored: "en" | "es") {
  const g = globalThis as unknown as G;
  const prev = {
    document: g.document,
    localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
  };
  const store = new Map<string, string>([["pm:lang", stored]]);
  const doc = {
    documentElement: { lang: stored },
    cookie: `pm_lang=${stored}`,
  };
  g.document = doc;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
  langSignal.value = stored;
  return {
    doc,
    store,
    restore() {
      if (prev.document === undefined) delete g.document;
      else g.document = prev.document;
      if (prev.localStorage) {
        Object.defineProperty(globalThis, "localStorage", prev.localStorage);
      } else delete g.localStorage;
    },
  };
}

Deno.test("REQ-416 setLang(l, { persist: false }) switches the screen but keeps the browser's stored language", () => {
  const b = fakeBrowser("en");
  try {
    setLang("es", { persist: false });
    assertEquals(langSignal.value, "es", "the signal follows");
    assertEquals(b.doc.documentElement.lang, "es", "<html lang> follows");
    assertEquals(b.store.get("pm:lang"), "en", "pm:lang untouched");
    assertEquals(b.doc.cookie, "pm_lang=en", "pm_lang cookie untouched");
  } finally {
    b.restore();
  }
});

Deno.test("REQ-416 plain setLang(l) still persists the choice", () => {
  const b = fakeBrowser("en");
  try {
    setLang("es");
    assertEquals(langSignal.value, "es");
    assertEquals(b.store.get("pm:lang"), "es");
    assertEquals(b.doc.cookie.startsWith("pm_lang=es"), true);
  } finally {
    b.restore();
  }
});
