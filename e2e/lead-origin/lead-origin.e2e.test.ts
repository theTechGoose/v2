/**
 * REQ-211 — Raphael, 2026-11-06: "There is a way to see where someone fills out a form to for a
 * call back, or a demo or a signup? There is something that says what landing page it is coming
 * from?" — "can you make it so the answer is yes?". Every landing form posts the page it is on
 * and the ad that brought the person: the call-me card on /landing5 (an island through the
 * landing client), the signup on /landing2 (an island), and the home page's signup (plain JS in
 * static/landing-scripts.js). The stories read the POST bodies on the fakes.
 */
import { story, type StoryTools } from "#shots";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** every POST to `path`, its JSON body */
function watchBodies(page: StoryTools["page"], path: string) {
  const bodies: Record<string, unknown>[] = [];
  page.on(
    "request",
    (req: { url(): string; method(): string; postData(): string | null }) => {
      if (req.method() === "POST" && req.url().includes(path)) {
        try {
          bodies.push(JSON.parse(req.postData() ?? "{}"));
        } catch {
          bodies.push({});
        }
      }
    },
  );
  return bodies;
}

async function untilPosted(bodies: unknown[], n = 1, ms = 10_000) {
  const t0 = Date.now();
  while (bodies.length < n && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

Deno.test("REQ-211: the call-me card on /landing5?ad=sabado posts the page and the ad; the home page's and /landing2's signups post their page", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // the call-me card, through the landing client
    const calls = watchBodies(page, "/demo-request");
    await page.goto("/landing5?ad=sabado");
    await expect.see("¿Necesitas ayuda? Te podemos llamar.");
    await page.locator("#c-name").fill("Ana López");
    await page.locator("#c-phone").fill(`512${digits()}`);
    await page.locator("[data-cy='l5-callme-send']").click();
    await untilPosted(calls);
    expect.eq(calls.length, 1, "one call posted");
    expect.eq(calls[0].page, "/landing5", "the page the card was on");
    expect.eq(calls[0].ad, "sabado", "the ad that brought the person");
    expect.eq(calls[0].mode, "call", "still the call it always was");

    // the /landing2 signup island: the page, no ad
    const codes = watchBodies(page, "/auth/send-otp");
    await page.goto("/landing2");
    await page.locator("#reg-phone").fill(`512${digits()}`);
    await page.locator("[data-cy='l2-send-code']").click();
    await untilPosted(codes);
    expect.eq(codes[0].page, "/landing2", "the page the signup was on");
    expect.eq("ad" in codes[0], false, "no ad on the URL: none posted");

    // the home page's signup (plain JS): the page is /
    await page.goto("/");
    await page.locator("#f-phone").fill(`512${digits()}`);
    await page.locator("#f-phone").press("Enter");
    await untilPosted(codes, 2);
    expect.eq(codes[1].page, "/", "the home page");
  }));
