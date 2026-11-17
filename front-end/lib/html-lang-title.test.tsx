/**
 * REQ-709 (demo-loop cycle 5, issue m4) — the shell's HtmlLang island heals the
 * tab title on mount. It followed the title only on a later language CHANGE
 * (REQ-367; the first signal value is skipped on purpose), so a page whose
 * server <title> came out in the other language (/dashboard?lang=en painting
 * "Panel · DocuMonster", fleet-6 stdout:257) kept it until the user switched.
 * Rendered for real: Preact mounts HtmlLang into a DOM whose <title> is a
 * DocTitle carrying both languages, and its effect runs.
 *
 *   cd front-end && deno test -A lib/html-lang-title.test.tsx
 */
import { assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { render } from "preact";
import HtmlLang from "../islands/HtmlLang.tsx";

function mountWith(
  title: string,
  attrs: string,
  initial: "en" | "es" | undefined,
) {
  const doc = new DOMParser().parseFromString(
    `<html lang="es"><head><title ${attrs}>${title}</title></head><body><div id="r"></div></body></html>`,
    "text/html",
  )!;
  const g = globalThis as unknown as { document?: unknown };
  const prev = g.document;
  g.document = doc;
  return {
    doc,
    async run() {
      render(<HtmlLang initial={initial} />, doc.getElementById("r") as never);
      // effects flush after paint: wait until HtmlLang's effect has run (it
      // sets <html lang> first, in the same effect as the title)
      const el = doc.documentElement as unknown as { lang: string };
      for (let i = 0; i < 100 && el.lang !== initial; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      assertEquals(el.lang, initial, "HtmlLang's mount effect ran");
    },
    restore() {
      render(null, doc.getElementById("r") as never);
      g.document = prev;
    },
  };
}

Deno.test("REQ-709 (m4): HtmlLang sets the DocTitle's English title on mount of an English page whose server title is Spanish", async () => {
  const m = mountWith(
    "Panel · DocuMonster",
    'data-title-en="Dashboard · DocuMonster" data-title-es="Panel · DocuMonster"',
    "en",
  );
  try {
    await m.run();
    assertEquals(m.doc.title, "Dashboard · DocuMonster");
  } finally {
    m.restore();
  }
});

Deno.test("REQ-709 (m4): HtmlLang leaves a title that is not a DocTitle (a landing's own) alone on mount", async () => {
  const m = mountWith("DocuMonster — Cotiza", "", "en");
  try {
    await m.run();
    assertEquals(m.doc.title, "DocuMonster — Cotiza");
  } finally {
    m.restore();
  }
});
