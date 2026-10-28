/**
 * REQ-125 — Crazy Egg's request (support@crazyegg.com, forwarded by Raphael 2026-10-28):
 * "install the Crazy Egg tracking script on https://documonster.com/landing2 … Paste the
 * JavaScript tag into the <head>".
 *
 * The script: shared/crazy-egg/script.ts (the page, the url, which loader),
 * front-end/components/CrazyEgg.tsx (the tag in the app shell's head, /landing2 only),
 * front-end/static/crazy-egg-fake.js (the fake the gate runs on).
 *
 *  - on fakes (DENO_DEPLOY unset) the fake is fetched and marks <html>;
 *  - on the real deploy the page requests Crazy Egg's script, it answers 200 over https
 *    and runs (its global `CE2` appears), with nothing refused by a CSP. Crazy Egg's CDN
 *    refuses a HeadlessChrome user agent (403), so a headless run presents Chrome's.
 * And the other pages carry no Crazy Egg tag at all.
 */
import { story } from "#shots";

const REAL = Boolean(Deno.env.get("DENO_DEPLOY")?.trim());
const SRC = "//script.crazyegg.com/pages/scripts/0110/3101.js";
const OTHERS = ["/", "/landing", "/login"];

Deno.test("REQ-125: /landing2 carries Crazy Egg's tracking script in its head and it loads; no other page carries it", (t) =>
  story(t, async ({ page, expect, http }) => {
    const scriptResponses: Array<{ url: string; status: number }> = [];
    const requests: string[] = [];
    const blocked: string[] = [];
    page.on("request", (req: { url(): string }) => {
      if (
        req.url().includes("script.crazyegg.com/pages/scripts/0110/3101.js")
      ) requests.push(req.url());
    });
    page.on("response", (res: { url(): string; status(): number }) => {
      if (
        res.url().includes("script.crazyegg.com/pages/scripts/0110/3101.js")
      ) {
        scriptResponses.push({ url: res.url(), status: res.status() });
      }
    });
    page.on("console", (msg: { type(): string; text(): string }) => {
      if (
        msg.type() === "error" &&
        /Content Security Policy|Refused to/.test(msg.text())
      ) {
        blocked.push(msg.text());
      }
    });
    if (REAL) {
      // Crazy Egg's CDN answers 403 (an HTML page) to a HeadlessChrome user agent and Chromium's ORB then refuses
      // the script (net::ERR_BLOCKED_BY_ORB, 2026-10-28); a person's browser — the user's headed --prod run — is
      // never headless. A headless story presents a browser's own user agent.
      const ua: string = await page.evaluate(() => navigator.userAgent);
      if (/HeadlessChrome/.test(ua)) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Network.setUserAgentOverride", {
          userAgent: ua.replace("HeadlessChrome", "Chrome"),
        });
      }
    }
    await page.goto("/landing2");
    const tag = page.locator("head script[data-crazy-egg]").first();
    await tag.waitFor({ state: "attached", timeout: 15000 });
    const src = (await tag.getAttribute("src")) ?? "";
    const mode = await tag.getAttribute("data-crazy-egg");
    expect(
      mode === (REAL ? "real" : "fake"),
      `/landing2: ${REAL ? "Crazy Egg's" : "the fake"} script — ${mode}`,
    );
    expect(
      REAL ? src === SRC : src === "/crazy-egg-fake.js",
      `/landing2: the src is ${
        REAL ? "Crazy Egg's tag verbatim" : "the app's own fake"
      } — ${src}`,
    );
    expect(
      (await tag.getAttribute("async")) !== null,
      "/landing2: the tag is async",
    );
    if (REAL) {
      // the deploy: the protocol-relative src resolves to https (301 from http on a local server) and answers 200 as JavaScript
      for (
        let i = 0;
        i < 150 && !scriptResponses.some((r) => r.status === 200);
        i++
      ) await page.waitForTimeout(100);
      expect(
        scriptResponses.some((r) =>
          r.status === 200 && r.url.startsWith("https://")
        ),
        `/landing2: Crazy Egg's script answered 200 over https — ${
          JSON.stringify(scriptResponses)
        }`,
      );
      // the script ran in the page: Crazy Egg's global
      await page.waitForFunction(
        () =>
          typeof (globalThis as unknown as { CE2?: unknown }).CE2 !==
            "undefined",
        null,
        { timeout: 15000 },
      );
      expect.eq(
        blocked.length,
        0,
        `/landing2: nothing of Crazy Egg was refused by a CSP — ${
          blocked.join(" | ")
        }`,
      );
    } else {
      await page.waitForFunction(
        () =>
          document.documentElement.getAttribute("data-crazy-egg-loaded") ===
            "fake",
        null,
        { timeout: 15000 },
      );
    }
    for (const path of OTHERS) {
      await page.goto(path);
      await page.locator("head script[data-google-tag]").first().waitFor({
        state: "attached",
        timeout: 15000,
      });
      expect.eq(
        await page.locator("script[data-crazy-egg]").count(),
        0,
        `${path}: no Crazy Egg tag off /landing2`,
      );
    }
    const res = await http("/crazy-egg-fake.js");
    expect.eq(
      res.status,
      200,
      "/crazy-egg-fake.js answers 200 (the gate's script)",
    );
    await res.body?.cancel();
    await expect.see("DocuMonster");
  }));
