/**
 * REQ-520 (demo cycle 3, issue m19) — on the real /field/workers page, a 3-digit PIN no longer
 * leaves a grey Add with no reason: Add stays enabled, a touched bad box says what it needs
 * ("Enter a 10-digit cell number." / "The PIN must be 4 digits."), Add on a bad form shows the
 * reason and creates nobody, and the Spanish default carries a visible one-line language note.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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

Deno.test("REQ-520 (demo m19): a 3-digit PIN says why Add can't add — inline, under the PIN box — and the Spanish default is explained", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/api\/field\/workers$/.test(r.url())) {
        posts.push(r.url());
      }
    });
    await page.goto("/field/workers");
    const form = page.locator("[data-cy='wk-form']");
    await form.waitFor({ timeout: 20_000 });
    // hydrated: the island has loaded the (empty) crew
    await page.getByText("No workers yet.").waitFor({ timeout: 20_000 });
    await page.locator("[data-cy='wk-name']").fill("Luis Herrera");
    const cell = `843${digits()}`;
    await page.locator("[data-cy='wk-phone']").fill(cell);
    await page.locator("[data-cy='wk-pin']").fill("123");
    const add = page.locator("[data-cy='wk-add']");
    expect(await add.isEnabled(), "Add is not greyed out with no reason");
    await add.click();
    const pinErr = page.locator("[data-cy='wk-pin-error']");
    await pinErr.waitFor({ timeout: 10_000 });
    expect.eq(
      (await pinErr.innerText()).trim(),
      "The PIN must be 4 digits.",
      "the reason sits under the PIN box",
    );
    expect(
      (await page.locator("[data-cy='wk-pin']").getAttribute(
        "aria-invalid",
      )) ===
        "true",
      "the PIN box is marked invalid",
    );
    expect(
      posts.length === 0,
      `an invalid form posts nothing (${posts.length})`,
    );

    await page.locator("[data-cy='wk-phone']").fill("512555");
    await page.locator("[data-cy='wk-pin']").click();
    const phoneErr = page.locator("[data-cy='wk-phone-error']");
    await phoneErr.waitFor({ timeout: 10_000 });
    expect.eq(
      (await phoneErr.innerText()).trim(),
      "Enter a 10-digit cell number.",
      "a touched short phone says what it needs",
    );
    await page.locator("[data-cy='wk-phone']").fill(cell);
    expect(await phoneErr.count() === 0, "a 10-digit phone clears it");

    expect.eq(
      (await page.locator("[data-cy='wk-lang-note']").innerText()).trim(),
      "Workers get their texts in Spanish unless you switch the language here.",
      "the Spanish default is explained in one line",
    );
    expect.eq(
      await page.locator("[data-cy='wk-language']").inputValue(),
      "es",
      "REQ-155: Spanish stays the default",
    );

    await page.locator("[data-cy='wk-pin']").fill("1234");
    expect(await pinErr.count() === 0, "a 4-digit PIN clears it");
    await add.click();
    await page.locator("[data-cy='wk-row']").first().waitFor({
      timeout: 15_000,
    });
    expect(posts.length === 1, "the valid form posts once");
    const list = await http("/api/field/workers", { headers: auth });
    const ws = await list.json();
    expect(
      Array.isArray(ws) &&
        ws.some((w: { name: string }) => w.name === "Luis Herrera"),
      "the worker was created",
    );
  }));
