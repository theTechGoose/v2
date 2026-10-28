/**
 * REQ-124 — Raphael, 2026-10-28: "i need to add this" (the Google tag snippet for
 * G-RN3H6L5263) — "and make sure google analytics works".
 *
 * The tag: shared/google-tag/tag.ts (the id, which loader, the snippet),
 * front-end/components/GoogleTag.tsx (the two scripts in the app shell's head, every page),
 * front-end/static/google-tag-fake.js (the fake loader the gate runs on).
 *
 * The story answers on the gate AND on the user's own run against the real services:
 *  - on fakes (DENO_DEPLOY unset) the loader is the app's own, and it marks <html>;
 *  - on the real deploy the page requests Google's gtag.js for the property, and that
 *    loader sends the page_view hit for the property to Google's collect endpoint — the
 *    proof the property hears the page — with nothing refused by a CSP.
 * Either way the snippet itself ran: `gtag` is a function and the dataLayer carries
 * `js` then `config G-RN3H6L5263`.
 */
import { story } from "#shots";

const GA_ID = "G-RN3H6L5263";
const REAL = Boolean(Deno.env.get("DENO_DEPLOY")?.trim());
const PAGES = ["/", "/login", "/privacy", "/landing2"];
const COLLECT = /(google-analytics\.com|analytics\.google\.com)\/g\/collect/;

Deno.test("REQ-124: every page carries the Google tag — the loader for G-RN3H6L5263 in the head, the dataLayer configured with it, the loader actually loaded", (t) =>
  story(t, async ({ page, expect, http }) => {
    const loaderRequests: string[] = [];
    const hits: string[] = [];
    const blocked: string[] = [];
    page.on("request", (req: { url(): string }) => {
      const u = req.url();
      if (u.includes("googletagmanager.com/gtag/js")) loaderRequests.push(u);
      if (COLLECT.test(u)) hits.push(u);
    });
    page.on("console", (msg: { type(): string; text(): string }) => {
      if (
        msg.type() === "error" &&
        /Content Security Policy|Refused to/.test(msg.text())
      ) {
        blocked.push(msg.text());
      }
    });
    const pageView = () =>
      hits.some((u) =>
        u.includes(`tid=${GA_ID}`) && u.includes("en=page_view")
      );
    for (const path of PAGES) {
      loaderRequests.length = 0;
      hits.length = 0;
      await page.goto(path);
      const loader = page.locator("head script[data-google-tag]").first();
      await loader.waitFor({ state: "attached", timeout: 15000 });
      const src = (await loader.getAttribute("src")) ?? "";
      const mode = await loader.getAttribute("data-google-tag");
      expect(
        src.includes(`id=${GA_ID}`),
        `${path}: the loader url names the property — ${src}`,
      );
      expect(
        mode === (REAL ? "real" : "fake"),
        `${path}: ${REAL ? "Google's" : "the fake"} loader — ${mode}`,
      );
      expect(
        REAL
          ? src.startsWith("https://www.googletagmanager.com/gtag/js")
          : src.startsWith("/google-tag-fake.js"),
        `${path}: the loader is ${
          REAL ? "Google's" : "the app's own"
        } — ${src}`,
      );
      const layer = await page.evaluate(() => {
        // deno-lint-ignore no-explicit-any
        const w = globalThis as any;
        return {
          gtag: typeof w.gtag,
          entries: Array.isArray(w.dataLayer)
            ? w.dataLayer.map((e: ArrayLike<unknown>) =>
              Array.from(e).map(String)
            )
            : null,
        };
      });
      expect.eq(layer.gtag, "function", `${path}: the snippet defined gtag()`);
      const entries = layer.entries ?? [];
      const js = entries.findIndex((e: string[]) => e[0] === "js");
      const config = entries.findIndex((e: string[]) =>
        e[0] === "config" && e[1] === GA_ID
      );
      expect(
        js >= 0,
        `${path}: dataLayer carries the js event — ${JSON.stringify(entries)}`,
      );
      expect(
        config > js,
        `${path}: dataLayer carries config ${GA_ID} after js — ${
          JSON.stringify(entries)
        }`,
      );
      if (REAL) {
        // Google's loader was fetched, and it sent this page's page_view for the property
        for (let i = 0; i < 150 && !pageView(); i++) {
          await page.waitForTimeout(100);
        }
        expect(
          loaderRequests.some((u) => u.includes(`id=${GA_ID}`)),
          `${path}: gtag.js was requested from Google — ${
            loaderRequests.join(" ")
          }`,
        );
        expect(
          pageView(),
          `${path}: a page_view hit for ${GA_ID} reached Google's collect endpoint — ${
            hits.map((u) => u.slice(0, 120)).join(" | ") || "no hit"
          }`,
        );
        expect.eq(
          blocked.length,
          0,
          `${path}: nothing of the tag was refused by a CSP — ${
            blocked.join(" | ")
          }`,
        );
      } else {
        // the fake loader was fetched and ran: it marks the document
        await page.waitForFunction(
          () =>
            document.documentElement.getAttribute("data-google-tag-loaded") ===
              "fake",
          null,
          { timeout: 15000 },
        );
      }
    }
    const res = await http("/google-tag-fake.js");
    expect.eq(
      res.status,
      200,
      "/google-tag-fake.js answers 200 (the gate's loader)",
    );
    await res.body?.cancel();
    await expect.see("DocuMonster");
  }));
