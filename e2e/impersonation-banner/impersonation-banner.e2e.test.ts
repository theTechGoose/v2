/**
 * REQ-181 — "i cant scroll up … both cases": while impersonating, the red banner must not
 * cover the shell. Run with SUPERADMIN_BOOTSTRAP_TOKEN set (shots' serve is stamped
 * DENO_DEPLOY=true, so the bootstrap route wants the token).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Rafa Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    }]),
  );
  return { auth, phone };
}

/** top / bottom of the first match, in viewport px */
const box = (page: StoryTools["page"], sel: string) =>
  page.evaluate((s: string) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, h: r.height };
  }, sel);

Deno.test("REQ-181: impersonating, /field/assignments and /assistant start below the banner — brand, top bar and first card fully visible, the shell's bottom at the window; after returning, the room is gone", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, phone } = await signIn(http, page, baseUrl);
    // a finished onboarding, so /dashboard and /admin are the shell, not the wizard
    await answerQuestions(http, auth, {
      name: "Rafa Story",
      businessName: "Story Co",
    });
    const token = Deno.env.get("SUPERADMIN_BOOTSTRAP_TOKEN") ?? "";
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ phoneNumber: phone, token }),
    });
    expect.eq(boot.status, 200, `bootstrap super admin (${await boot.text()})`);
    // the user being impersonated: brand new, no name — "Nuevo usuario", Spanish
    const other = `+1512${digits()}`;
    await (await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: other, code: "000000" }),
    })).body?.cancel();
    const otherId =
      ((await (await http(`/api/admin/users?q=${other.slice(2)}`, {
        headers: auth,
      })).json()) as { id: string }[])[0].id;

    await page.setViewportSize({ width: 1400, height: 800 });
    await page.goto("/dashboard");
    const status = await page.evaluate(
      async (id: string) =>
        (await fetch(`/api/admin/impersonate/${id}`, { method: "POST" }))
          .status,
      otherId,
    );
    expect.eq(status, 200, "impersonation started");

    for (const url of ["/field/assignments", "/assistant"]) {
      await page.goto(url);
      const banner = page.locator("[data-cy='imp-banner']");
      await banner.waitFor({ timeout: 15_000 });
      await page.locator(".topbar").waitFor({ timeout: 15_000 });
      // let the island measure itself
      await page.waitForFunction(
        () =>
          (document.querySelector(".topbar")?.getBoundingClientRect().top ??
            0) > 0,
        undefined,
        { timeout: 10_000 },
      );
      const b = (await box(page, "[data-cy='imp-banner']"))!;
      const top = (await box(page, ".topbar"))!;
      const brand = (await box(page, ".sb__brand"))!;
      const app = (await box(page, ".app"))!;
      const vh = await page.evaluate(() => innerHeight);
      expect.eq(b.h > 20, true, `${url}: the banner is drawn (${b.h}px)`);
      expect.eq(
        top.top >= b.bottom - 0.5,
        true,
        `${url}: the top bar starts below the banner (topbar ${top.top} vs banner ${b.bottom})`,
      );
      expect.eq(
        brand.top >= b.bottom - 0.5,
        true,
        `${url}: the sidebar's brand starts below the banner (${brand.top} vs ${b.bottom})`,
      );
      expect.eq(
        app.bottom <= vh + 0.5,
        true,
        `${url}: the shell still ends at the window (${app.bottom} vs ${vh})`,
      );
    }
    // the first card on /assistant (Conversations) is fully visible too
    const card = await box(page, ".asst");
    const b2 = (await box(page, "[data-cy='imp-banner']"))!;
    if (card) {
      expect.eq(
        card.top >= b2.bottom - 0.5,
        true,
        `the assistant shell starts below the banner (${card.top} vs ${b2.bottom})`,
      );
    }

    // return to the real account: no banner, and the room with it
    const stopped = await page.evaluate(async () =>
      (await fetch("/api/admin/stop-impersonating", { method: "POST" })).status
    );
    expect.eq(stopped, 200, "impersonation stopped");
    await page.goto("/admin");
    await page.locator(".topbar").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    expect.eq(
      await page.locator("[data-cy='imp-banner']").count(),
      0,
      "no banner once back",
    );
    const topAfter = (await box(page, ".topbar"))!;
    expect.eq(topAfter.top, 0, "the top bar is back at the window's top");
    const pad = await page.evaluate(() =>
      getComputedStyle(document.body).paddingTop
    );
    expect.eq(pad, "0px", "the body's room is released");
  }));
