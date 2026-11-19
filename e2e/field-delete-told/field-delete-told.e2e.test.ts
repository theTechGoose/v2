/**
 * REQ-1006 — LOOP-007 cycle 1, QA issue q1-92: deleting a scheduled one-off on
 * /field/tasks while the account's fieldTexts flag is off (a fresh account) sends the customer
 * no text (REQ-177), and the flash must say so — not a bare "Task deleted".
 */
import { story, type StoryTools } from "#shots";

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
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Field Story" }),
  });
  await me.body?.cancel();
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
  return { auth };
}

/** the company's day — the backend's FIELD_TZ default (America/New_York) */
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());


Deno.test("REQ-1006 (LOOP-007 q1-92): delete tomorrow's one-off on a fresh account → the flash says the customer was not told", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const post = async (path: string, body: unknown) => {
      const r = await http(path, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
      });
      return r.json();
    };
    const customer = await post("/api/customers", {
      name: "Ana Torres",
      phoneNumber: "+18435550277",
    });
    const worker = await post("/api/field/workers", {
      name: "Luis Herrera",
      phoneNumber: `843${digits()}`,
      pin: "1234",
    });
    const next = new Date(todayIso() + "T12:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    const tomorrow = next.toISOString().slice(0, 10);
    const made = await post("/api/field/tasks", {
      customerId: customer.id,
      date: tomorrow,
      taskTypeName: "Hedge trimming",
      priceCents: 8000,
      workerId: worker.id,
    });
    expect.eq(made.date, tomorrow, "the one-off is on tomorrow");

    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-date']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='tk-next']").click();
    await page.waitForFunction(
      (d) =>
        (document.querySelector("[data-cy='tk-date']") as
          | HTMLInputElement
          | null)?.value === d,
      tomorrow,
      { timeout: 15_000 },
    );
    const task = page.locator("[data-cy='tk-task'][data-oneoff='true']")
      .first();
    await task.waitFor({ timeout: 15_000 });
    await task.locator("[data-cy='tk-delete']").click();
    const [res] = await Promise.all([
      page.waitForResponse((r) =>
        r.request().method() === "DELETE" &&
        r.url().includes(`/field/tasks/${made.id}`)
      ),
      task.locator("[data-cy='tk-delete-confirm']").click(),
    ]);
    const body = await res.json();
    expect.eq(body.texted, false, "fieldTexts is off — the route answers texted:false");
    const flash = page.locator("[data-cy='tk-flash']");
    await flash.waitFor({ timeout: 15_000 });
    const text = (await flash.innerText()).replace(/\s+/g, " ").trim();
    expect(
      /not told/i.test(text) && /ana torres/i.test(text), // the flash is uppercased by CSS
      `the flash tells the owner Ana Torres was not told (got "${text}")`,
    );
  }));
