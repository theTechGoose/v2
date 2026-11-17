/**
 * REQ-421 (demo cycle 2, issue m42) — on the real /field/workers page, adding a worker whose cell
 * is already a worker's sign-in shows a worded message UNDER the Phone box (English, then Spanish
 * after a language flip), never the server's raw "a worker with that cell already exists".
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

Deno.test("REQ-421 (demo m42): a cell already used for a worker sign-in is refused in words under the Phone box — English and Spanish — never the server's raw string", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const cell = `843${digits()}`;
    const w = await http("/api/field/workers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Luis Herrera",
        phoneNumber: cell,
        pin: "1234",
      }),
    });
    expect(w.status === 201, `first worker created (${w.status})`);
    await w.body?.cancel();

    await page.goto("/field/workers");
    await page.locator("[data-cy='wk-row']").first().waitFor({
      timeout: 20_000,
    });
    const tryAdd = async () => {
      await page.locator("[data-cy='wk-name']").fill("Luis Again");
      await page.locator("[data-cy='wk-phone']").fill(cell);
      await page.locator("[data-cy='wk-pin']").fill("5678");
      await page.locator("[data-cy='wk-add']").click();
    };
    await tryAdd();
    const under = page.locator("[data-cy='wk-phone-error']");
    await under.waitFor({ timeout: 15_000 });
    expect.eq(
      (await under.innerText()).trim(),
      "That cell number is already used for a worker sign-in. Use a different number.",
      "the worded English message under the Phone box",
    );
    expect(
      (await page.locator("[data-cy='wk-phone']").getAttribute(
        "aria-invalid",
      )) === "true",
      "the Phone box is marked invalid",
    );
    expect(
      (await page.locator("[data-cy='wk-phone'] ~ [data-cy='wk-phone-error']")
        .count()) === 1,
      "the message sits inside the Phone box's label, right under the input",
    );
    const text = await page.locator("[data-cy='wk-form']").innerText();
    expect(
      !/already exists/.test(text),
      `no raw server string on the form (${text})`,
    );

    // the same refusal in Spanish
    await page.context().addCookies([
      ...new Set([
        new URL(baseUrl).hostname,
        "localhost",
        "127.0.0.1",
      ]),
    ].map((domain) => ({ name: "pm_lang", value: "es", domain, path: "/" })));
    await (await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "es" }),
    })).body?.cancel();
    await page.goto("/field/workers");
    await page.locator("[data-cy='wk-row']").first().waitFor({
      timeout: 20_000,
    });
    await tryAdd();
    await under.waitFor({ timeout: 15_000 });
    expect.eq(
      (await under.innerText()).trim(),
      "Ese número de celular ya se usa para el acceso de un trabajador. Usa otro número.",
      "the worded Spanish message under the Phone box",
    );

    // a new number clears the refusal
    await page.locator("[data-cy='wk-phone']").fill(`843${digits()}`);
    expect(await under.count() === 0, "typing a new number clears it");
  }));
