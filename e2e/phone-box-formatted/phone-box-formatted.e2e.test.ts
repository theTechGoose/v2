/**
 * REQ-1120 (LOOP-007 cycle 3, q3-48 + q3-49) — a phone number filled the way the Phone box's own
 * placeholder "(555) 123-4567" shows it is taken whole, on /field/workers → New worker
 * (data-cy=wk-phone) and on /admins → Invite an editor (data-cy=adm-phone). page.fill goes
 * through the browser's maxlength cut exactly as a paste does, so with maxlength={10} the box
 * held "84355501" / "843555" and the add / invite could not go. On /admins a short number also
 * says why Invite does nothing (adm-phone-error), instead of a silently disabled button.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
/** a random 843 cell: its 10 digits and the two ways people type it */
function cell() {
  const d = `843${digits()}`;
  return {
    d,
    dashed: `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`,
    paren: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`,
  };
}

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
    body: JSON.stringify({ language: "en", name: "Hank Field" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return { auth };
}

Deno.test("REQ-1120 (LOOP-007 q3-48): New worker takes a phone filled as '843-555-0123' or '(843) 555-0123' — the box holds all 10 digits, Add posts and the row shows the number", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await page.goto("/field/workers");
    await page.locator("[data-cy='wk-form']").waitFor({ timeout: 20_000 });
    await page.getByText("No workers yet.").waitFor({ timeout: 20_000 });
    const phone = page.locator("[data-cy='wk-phone']");

    for (const [i, form] of (["dashed", "paren"] as const).entries()) {
      const c = cell();
      const name = `Luis Phone${i}`;
      await page.locator("[data-cy='wk-name']").fill(name);
      await phone.fill(c[form]);
      const held = (await phone.inputValue()).replace(/\D/g, "");
      expect.eq(held, c.d, `the box holds all 10 digits of "${c[form]}"`);
      await page.locator("[data-cy='wk-pin']").fill("1234");
      const posted = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          /\/api\/field\/workers$/.test(r.url()),
        { timeout: 15_000 },
      ).catch(() => null);
      await page.locator("[data-cy='wk-add']").click();
      const res = await posted;
      expect(
        !!res && res.status() === 201,
        `Add posts the worker for "${c[form]}" (${res?.status() ?? "no POST"})`,
      );
      const row = page.locator("[data-cy='wk-row']", { hasText: name });
      await row.waitFor({ timeout: 15_000 });
      expect.eq(
        (await row.locator("[data-cy='wk-row-phone']").innerText()).trim(),
        c.paren,
        "the new row shows the number",
      );
    }
    const list = await (await http("/api/field/workers", { headers: auth }))
      .json();
    expect.eq(list.length, 2, "both workers were created");
  }));

Deno.test("REQ-1120 (LOOP-007 q3-49): Invite an editor takes a phone filled as '(843) 555-0123' or '843-555-0123' — 10 digits held, Invite enabled and sent, the row listed; a short number says why under the Phone box", (t) =>
  story(t, async ({ page, expect, baseUrl, http }) => {
    await signIn(http, page, baseUrl);
    await page.goto("/admins");
    const invite = page.locator("[data-cy='adm-invite']");
    await invite.waitFor({ timeout: 20_000 });
    const phone = page.locator("[data-cy='adm-phone']");
    const name = page.locator("[data-cy='adm-name']");

    for (const [i, form] of (["paren", "dashed"] as const).entries()) {
      const c = cell();
      const who = `Sofia Phone${i}`;
      await phone.fill(c[form]);
      await name.fill(who);
      const held = (await phone.inputValue()).replace(/\D/g, "");
      expect.eq(held, c.d, `the box holds all 10 digits of "${c[form]}"`);
      expect(
        !(await invite.isDisabled()),
        `Invite is enabled for "${c[form]}"`,
      );
      await invite.click({ timeout: 5_000 }).catch(() => {});
      const row = page.locator("[data-cy='adm-row']", { hasText: who });
      await row.waitFor({ timeout: 15_000 });
      expect.eq(
        (await row.locator("[data-cy='adm-row-phone']").innerText()).trim(),
        c.paren,
        "the new editor row shows the number",
      );
      await page.locator("[data-cy='adm-sent']").waitFor({ timeout: 10_000 });
    }

    // a number that really is short says why Invite does nothing
    await phone.fill("84355");
    await name.fill("Short Number");
    await phone.blur();
    const err = page.locator("[data-cy='adm-phone-error']");
    const shown = await err.waitFor({ timeout: 10_000 }).then(() => true)
      .catch(() => false);
    expect(shown, "a short number shows adm-phone-error under the Phone box");
    expect.eq(
      await phone.getAttribute("aria-invalid"),
      "true",
      "the Phone box is marked invalid",
    );
  }));
