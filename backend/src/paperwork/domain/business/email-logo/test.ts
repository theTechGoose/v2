import { assert, assertEquals } from "#std/assert";
import { emailLogo, emailLogoHtml } from "./mod.ts";
import { logoVersion } from "#quote-flow/public-logo-url.ts";

// REQ-160 — "these have the house logo on it not the client logo"
// REQ-628 — A2Z Landscape feedback, 2026-11-12: "They NEED THEIR LOGO NOT OURS" — no logo on
// file is the business name as a text wordmark, never the DocuMonster logo.
Deno.test("REQ-160 REQ-628 emailLogo: a business with a logo on file brands the email with it (the public-logo URL, named after the business); without one its name is a text wordmark, never the house logo", () => {
  const app = "https://documonster.com";
  assertEquals(
    emailLogo({
      appUrl: app,
      kind: "invoice",
      id: "inv-1",
      biz: { businessName: "A2Z Landscape LLC", logoFileId: "f-9" },
    }),
    {
      kind: "image",
      src: `https://documonster.com/api/public-logo/invoice/inv-1?v=${logoVersion("f-9")}`,
      alt: "A2Z Landscape LLC",
    },
  );
  assertEquals(
    emailLogo({
      appUrl: app,
      kind: "quote",
      id: "q-1",
      biz: { businessName: "A2Z Landscape LLC", logoFileId: "f-9" },
    }),
    {
      kind: "image",
      src: `https://documonster.com/api/public-logo/quote/q-1?v=${logoVersion("f-9")}`,
      alt: "A2Z Landscape LLC",
    },
  );
  // a logo but no business name → the alt still says something
  const named = emailLogo({ appUrl: app, kind: "invoice", id: "inv-1", biz: { logoFileId: "f-9" } });
  assertEquals(named.kind === "image" && named.alt, "Logo");
  // no logo → the business name as a wordmark
  assertEquals(
    emailLogo({ appUrl: app, kind: "invoice", id: "inv-1", biz: { businessName: "A2Z Landscape LLC" } }),
    { kind: "wordmark", text: "A2Z Landscape LLC" },
  );
  // no identity → the contractor's name; nothing at all → an empty wordmark (rendered as nothing)
  assertEquals(
    emailLogo({ appUrl: app, kind: "invoice", id: "inv-1", biz: undefined, fallbackName: "Alexander Jerez" }),
    { kind: "wordmark", text: "Alexander Jerez" },
  );
  assertEquals(
    emailLogo({ appUrl: app, kind: "invoice", id: "inv-1", biz: undefined }),
    { kind: "wordmark", text: "" },
  );
});

// REQ-613 (demo-loop cycle 4, M31) — a replaced logo must not hide behind the old URL's cache
Deno.test("REQ-613 emailLogo: the logo URL carries the logo's version, so a replaced logo gets a new URL", () => {
  const app = "https://documonster.com";
  const srcOf = (l: ReturnType<typeof emailLogo>) => l.kind === "image" ? l.src : "";
  const orange = srcOf(emailLogo({ appUrl: app, kind: "quote", id: "q-1", biz: { logoFileId: "f-orange" } }));
  const blue = srcOf(emailLogo({ appUrl: app, kind: "quote", id: "q-1", biz: { logoFileId: "f-blue" } }));
  assertEquals(orange, `${app}/api/public-logo/quote/q-1?v=${logoVersion("f-orange")}`);
  assertEquals(blue === orange, false, "a new logo is a new URL");
  assertEquals(orange.includes("f-orange"), false, "the file id never leaks");
});

Deno.test("REQ-628 emailLogoHtml: the logo scales into a fixed box keeping its aspect ratio; the wordmark is the escaped name; nothing names DocuMonster", () => {
  const img = emailLogoHtml({ kind: "image", src: "https://x/api/public-logo/invoice/i", alt: "A&B" });
  assert(img.includes('src="https://x/api/public-logo/invoice/i"'));
  assert(img.includes('alt="A&amp;B"'));
  assert(/max-width:\s*200px/.test(img) && /max-height:\s*64px/.test(img), img);
  assert(/height:\s*auto/.test(img) && /width:\s*auto/.test(img), "aspect ratio kept");
  const word = emailLogoHtml({ kind: "wordmark", text: "A2Z <Landscape>" });
  assert(word.includes("A2Z &lt;Landscape&gt;"));
  assert(word.includes('data-biz-wordmark'));
  assertEquals(emailLogoHtml({ kind: "wordmark", text: "" }), "");
  for (const h of [img, word]) assertEquals(/DocuMonster|logo-email\.png/i.test(h), false);
});
