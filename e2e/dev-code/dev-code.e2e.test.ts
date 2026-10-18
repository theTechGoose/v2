/**
 * REQ-082 — Raphael, 2026-10-16, on the pin, after the code never came: "for the fake you should
 * have a pop up with the code."
 *
 * On the fakes (DENO_DEPLOY unset: the gate, a dev box, a pin) no text goes out, so the code the
 * server stored rides the send-otp reply and the page shows it: /landing2 in its own card, and
 * /verify for the pages that hand off to it ("/", /landing, /login). "Use this code" fills it in
 * and it signs the person in — it is the stored code, not the master code.
 */
import { story, type StoryTools } from "#shots";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const DESKTOP = { width: 1280, height: 900 };

async function popupCode(
  page: StoryTools["page"],
  expect: StoryTools["expect"],
  where: string,
): Promise<string> {
  const popup = page.locator("[data-cy='dev-code']");
  await popup.waitFor({ state: "visible", timeout: 15_000 });
  const code =
    (await popup.locator("[data-cy='dev-code-value']").textContent() ?? "")
      .trim();
  expect(
    /^\d{6}$/.test(code),
    `${where}: the popup shows the six-digit code (${code})`,
  );
  expect(code !== "000000", `${where}: the stored code, not the master code`);
  return code;
}

Deno.test('REQ-082: on the fakes the code pops up on the page that sent it — /landing2 in the card, and /verify after "/", /landing and /login — and "Use this code" signs in', (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    // /landing2: the popup on the code step, Use fills the field, confirm → done
    await page.goto("/landing2?lang=en");
    await page.locator("#reg-phone").fill(`512${digits()}`);
    await page.locator("[data-cy='l2-send-code']").click();
    const l2code = await popupCode(page, expect, "/landing2");
    await expect.see("this is your code");
    await page.locator("[data-cy='dev-code-use']").click();
    // the code types itself into the slots and the sixth digit submits (REQ-083)
    await page.waitForFunction(
      (c: string) =>
        (document.querySelector("#reg-code") as HTMLInputElement | null)
          ?.value === c,
      l2code,
      { timeout: 5000 },
    );
    await page.waitForURL((u: URL) => u.pathname !== "/landing2", {
      timeout: 60_000,
    });
    await page.waitForLoadState("networkidle"); // the app redirects once more; let it land before the cookies go
    expect(
      !page.url().includes("/login"),
      `/landing2: straight into the app (${page.url()})`,
    );
    await page.context().clearCookies();

    // /login → /verify: the popup carries over, Use signs in
    await page.goto("/login");
    await page.locator("input[type='tel']").fill(`512${digits()}`);
    await page.locator("button[type='submit']").click();
    await page.waitForURL((u: URL) => u.pathname === "/verify");
    await popupCode(page, expect, "/login → /verify");
    await page.locator("[data-cy='dev-code-use']").click();
    await page.waitForURL((u: URL) => u.pathname !== "/verify", {
      timeout: 15_000,
    });
    await page.waitForLoadState("networkidle"); // the app redirects once more; let it land before the cookies go
    expect(
      !page.url().includes("/login"),
      `/login → /verify: signed in (${page.url()})`,
    );
    await page.context().clearCookies();

    // "/" (the static script) → /verify
    await page.goto("/");
    await page.locator("#f-phone").fill(`512${digits()}`);
    await page.locator("#contact-form").evaluate((f: HTMLFormElement) =>
      f.requestSubmit()
    );
    await page.waitForURL((u: URL) => u.pathname === "/verify", {
      timeout: 60_000,
    });
    await popupCode(page, expect, "/ → /verify");
    // the popup can be closed, and a reload does not bring it back
    await page.locator("[data-cy='dev-code-close']").click();
    expect.eq(await page.locator("[data-cy='dev-code']").count(), 0, "closed");
    await page.goto(page.url());
    expect.eq(
      await page.locator("[data-cy='dev-code']").count(),
      0,
      "a reload shows no stale code",
    );

    // /landing → /verify
    await page.goto("/landing?lang=en");
    await page.locator("#trial-phone").fill(`512${digits()}`);
    await page.locator("#trial-phone").evaluate((el: HTMLInputElement) =>
      el.form!.requestSubmit()
    );
    await page.waitForURL((u: URL) => u.pathname === "/verify", {
      timeout: 60_000,
    });
    await popupCode(page, expect, "/landing → /verify");

    // resend on /verify: a fresh number straight on the code page (the numbers above are inside the
    // 30 s send cooldown, which refuses a resend), "Resend code" → the popup → Use signs in
    await page.context().clearCookies();
    await page.goto(
      `/verify?phone=${encodeURIComponent(`+1512${digits()}`)}&lang=en`,
    );
    expect.eq(
      await page.locator("[data-cy='dev-code']").count(),
      0,
      "resend: no popup before — nothing was sent to this number",
    );
    const resend = page.locator(".meta button");
    for (
      let i = 0;
      i < 10 && (await page.locator("[data-cy='dev-code']").count()) === 0;
      i++
    ) {
      await resend.click({ timeout: 2000 }).catch(() => {}); // the island may still be hydrating
      await page.waitForTimeout(300);
    }
    await popupCode(page, expect, "resend on /verify");
    await page.locator("[data-cy='dev-code-use']").evaluate((el: HTMLElement) =>
      el.click()
    );
    await page.waitForURL((u: URL) => u.pathname !== "/verify", {
      timeout: 15_000,
    });
    expect(
      !page.url().includes("/login"),
      `resend on /verify: Use signs in (${page.url()})`,
    );
  }));
