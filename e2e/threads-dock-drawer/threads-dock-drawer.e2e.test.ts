/**
 * REQ-724 — demo-loop cycle 5, issue M27: on a phone, the ☰ drawer on /assistant docks the
 * Conversations list into its column (P-22b), but the dock was a z-index 61 overlay over the
 * drawer's lower 42vh, so "Worker view" and "Log out" sat under it (elementFromPoint hit
 * thread__client / thread__chips). Now the drawer reserves the dock's height: every one of
 * its bottom actions is the topmost element at its own centre, the dock never overlaps them,
 * and the conversations are still there and tappable.
 *
 * Pages: front-end/routes/assistant/index.tsx (islands AsstThreads.tsx, DashSidebar.tsx).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const SEED = 12;

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
  });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: body.recoveryToken }),
    });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Dock User", language: "en" }],
      ["/api/profile/identity", { businessName: "Dock Business" }],
    ] as const
  ) {
    const res = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(payload),
    });
    await res.body?.cancel();
  }
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return auth;
}

interface Hit {
  label: string;
  found: boolean;
  onTop: boolean;
  hitClass: string;
  top: number;
  bottom: number;
}

/** For each of the drawer's bottom actions: is it the topmost element at its centre? */
function probe(page: StoryTools["page"]) {
  return page.evaluate(() => {
    const pick = (label: string, sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) {
        return {
          label,
          found: false,
          onTop: false,
          hitClass: "",
          top: 0,
          bottom: 0,
        };
      }
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return {
        label,
        found: true,
        onTop: Boolean(hit && el.contains(hit)),
        hitClass: hit
          ? String((hit as HTMLElement).className || hit.tagName)
          : "none",
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
      };
    };
    const dock = document.querySelector<HTMLElement>(
      "aside.threads.threads--dock",
    );
    const d = dock?.getBoundingClientRect();
    const first = dock?.querySelector<HTMLElement>(".thread");
    const fr = first?.getBoundingClientRect();
    const firstHit = fr
      ? document.elementFromPoint(
        fr.left + fr.width / 2,
        fr.top + fr.height / 2,
      )
      : null;
    return {
      hits: [
        pick("Settings / account", ".sb .sb__footer"),
        pick("Worker view", ".sb [data-cy='nav-worker-view']"),
        pick("Log out", ".sb .nav-item--logout"),
      ],
      dockTop: d ? Math.round(d.top) : -1,
      dockHeight: d ? Math.round(d.height) : 0,
      firstThreadOnTop: Boolean(first && firstHit && first.contains(firstHit)),
    };
  });
}

for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
  Deno.test(`REQ-724: ${vp.width}×${vp.height} — with the ☰ drawer open on /assistant, the Conversations dock does not cover Worker view or Log out (cycle 5, M27)`, (t) =>
    story(t, async ({ page, expect, http, baseUrl, folder }) => {
      const auth = await signIn(http, page, baseUrl);
      for (let i = 0; i < SEED; i++) {
        const res = await http("/api/agents/conversations", {
          method: "POST",
          headers: auth,
          body: "{}",
        });
        await res.body?.cancel();
      }
      await page.setViewportSize(vp);
      await page.goto("/assistant");
      const menu = page.locator("[data-cy='mobile-menu']");
      await menu.waitFor({ timeout: 20_000 });
      await page.locator(".sb .nav-item--logout").waitFor({
        state: "attached",
        timeout: 20_000,
      });
      await page.locator(".thread").nth(SEED - 1).waitFor({
        state: "attached",
        timeout: 20_000,
      });
      await menu.click();
      await page.locator(".sb.sb--open").waitFor({ timeout: 5_000 });
      await page.locator("aside.threads.threads--dock").waitFor({
        state: "visible",
        timeout: 5_000,
      });
      await page.waitForTimeout(500); // the drawer slides (240 ms)
      await page.screenshot({
        path: `${folder}/drawer-dock-${vp.width}x${vp.height}.png`,
      });

      const m = await probe(page);
      for (const h of m.hits as Hit[]) {
        expect(h.found, `${h.label} is in the open drawer`);
        expect(
          h.onTop,
          `${h.label} is the topmost element at its centre (y ${h.top}–${h.bottom}); elementFromPoint hit "${h.hitClass}", dock top ${m.dockTop}`,
        );
        expect(
          h.bottom <= m.dockTop,
          `${h.label} ends (${h.bottom}) above the Conversations dock (${m.dockTop})`,
        );
      }
      expect(
        m.dockHeight > 80,
        `the Conversations dock is still shown in the drawer (${m.dockHeight}px tall)`,
      );
      expect(
        m.firstThreadOnTop,
        "the first conversation in the dock is tappable",
      );

      // and Log out is a real click target: Playwright's actionability check refuses a covered element
      await page.locator(".sb [data-cy='nav-worker-view']").click({
        trial: true,
        timeout: 3_000,
      });
      await page.locator(".sb .nav-item--logout").click({
        trial: true,
        timeout: 3_000,
      });
    }));
}
