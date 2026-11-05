/**
 * REQ-183 — Raphael, 2026-11-05: "install this" — Emily Keck's Google Tag Manager
 * install instructions: the container snippet as high as possible inside <head> on every
 * page, the noscript iframe right after the opening <body> tag on every page.
 *
 * The container: shared/google-tag-manager/gtm.ts (which id, which loader, the snippet),
 * front-end/components/GoogleTagManager.tsx (the head script + the body noscript in the app
 * shell), front-end/static/gtm-fake.js (the fake loader the gate runs on).
 *
 * The story answers on the gate AND on a run against the real services:
 *  - on fakes (DENO_DEPLOY unset) the loader is the app's own, and it marks <html>;
 *  - on the real deploy (DENO_DEPLOY=true with a GTM_ID) the page requests Google's gtm.js
 *    for the container and the noscript iframe is the body's first child.
 * Either way the snippet ran first in the head: the dataLayer carries gtm.start before
 * anything else and the snippet's script is the head's first <script>.
 */
import { story } from "#shots";

const REAL = Boolean(Deno.env.get("DENO_DEPLOY")?.trim());
const GTM_ID = Deno.env.get("GTM_ID")?.trim() || "GTM-FAKE000";
const PAGES = ["/", "/login", "/privacy", "/landing2"];

Deno.test("REQ-183: every page carries Google Tag Manager — the container snippet first in the head, gtm.start on the dataLayer, the loader fetched; on the real deploy the noscript iframe first in the body", (t) =>
  story(t, async ({ page, expect, http }) => {
    const loaderRequests: string[] = [];
    page.on("request", (req: { url(): string }) => {
      const u = req.url();
      if (
        u.includes("googletagmanager.com/gtm.js") || u.includes("/gtm-fake.js")
      ) {
        loaderRequests.push(u);
      }
    });
    for (const path of PAGES) {
      loaderRequests.length = 0;
      await page.goto(path);
      const snippet = page.locator("head script[data-gtm]").first();
      await snippet.waitFor({ state: "attached", timeout: 15000 });
      const mode = await snippet.getAttribute("data-gtm");
      expect(
        mode === (REAL ? "real" : "fake"),
        `${path}: ${REAL ? "Google's" : "the fake"} loader — ${mode}`,
      );
      // the served HTML: the snippet right after the charset meta, before every other tag
      const res = await http(path);
      const html = await res.text();
      expect(
        /<head>\s*<meta charset="utf-8"\s*\/?>\s*<script[^>]*\bdata-gtm=/.test(
          html,
        ),
        `${path}: the container snippet is the head's first tag after the charset meta — ${
          html.slice(html.indexOf("<head>"), html.indexOf("<head>") + 160)
        }`,
      );
      const shape = await page.evaluate(() => {
        // deno-lint-ignore no-explicit-any
        const w = globalThis as any;
        const scripts = Array.from(document.head.querySelectorAll("script"))
          .map((s) => ({
            gtm: s.hasAttribute("data-gtm"),
            src: s.getAttribute("src") ?? "",
          }));
        const bodyFirst = document.body.firstElementChild;
        return {
          scripts: scripts.slice(0, 6),
          entries: Array.isArray(w.dataLayer)
            ? w.dataLayer.map((e: unknown) => JSON.stringify(e))
            : null,
          bodyFirstTag: bodyFirst?.tagName.toLowerCase() ?? "",
          bodyFirstHtml: bodyFirst?.outerHTML.slice(0, 200) ?? "",
          noscript: bodyFirst?.tagName === "NOSCRIPT"
            ? bodyFirst.textContent ?? ""
            : "",
        };
      });
      // in the DOM every loader (this one, gtag's, the pixel's) has inserted
      // itself before the first script, so order among the src scripts is
      // theirs; the snippet is the head's first INLINE script
      const firstInline = shape.scripts.find((s) => !s.src);
      expect(
        firstInline?.gtm === true,
        `${path}: the snippet is the head's first inline script — ${
          JSON.stringify(shape.scripts)
        }`,
      );
      const entries = shape.entries ?? [];
      expect(
        entries.length > 0 && entries[0].includes('"gtm.start"') &&
          entries[0].includes('"event":"gtm.js"'),
        `${path}: dataLayer carries gtm.start first — ${
          JSON.stringify(entries).slice(0, 200)
        }`,
      );
      // the loader was asked for, with the container on the url
      for (let i = 0; i < 100 && loaderRequests.length === 0; i++) {
        await page.waitForTimeout(100);
      }
      expect(
        loaderRequests.some((u) => u.includes(`id=${GTM_ID}`)),
        `${path}: the ${
          REAL ? "Google" : "fake"
        } loader was requested for ${GTM_ID} — ${loaderRequests.join(" ")}`,
      );
      if (REAL) {
        expect(
          loaderRequests.some((u) =>
            u.startsWith("https://www.googletagmanager.com/gtm.js?id=")
          ),
          `${path}: the loader is Google's — ${loaderRequests.join(" ")}`,
        );
        expect.eq(
          shape.bodyFirstTag,
          "noscript",
          `${path}: the noscript is the body's first child — ${shape.bodyFirstHtml}`,
        );
        expect(
          shape.noscript.includes(
            `https://www.googletagmanager.com/ns.html?id=${GTM_ID}`,
          ),
          `${path}: the noscript iframe points at Google's ns.html for the container — ${
            shape.noscript.slice(0, 200)
          }`,
        );
      } else {
        await page.waitForFunction(
          () =>
            document.documentElement.getAttribute("data-gtm-loaded") === "fake",
          null,
          { timeout: 15000 },
        );
      }
    }
    const res = await http("/gtm-fake.js");
    expect.eq(res.status, 200, "/gtm-fake.js answers 200 (the gate's loader)");
    await res.body?.cancel();
    await expect.see("DocuMonster");
  }));
