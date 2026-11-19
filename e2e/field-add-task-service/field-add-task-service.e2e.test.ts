/**
 * REQ-1159 — AMENDMENT of REQ-921/REQ-979 (LOOP-007 cycle 3, q3-91): "Add task Service box has
 * no '+ Add as a service' option". QA opened /field/tasks → Add task, typed "Leaf cleanup" in the
 * Service box and saw no dropdown at all, while the repeat-visit form offers
 * `+ Add "<name>" as a service`. The walk, in a real browser: sign in, put a customer and a worker
 * on the account, open Add task, pick the customer, type a new service name, expect the create row,
 * click it (the service lands in the catalogue and is picked), price it, save — the task bills it.
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
  // the backend may still be booting when the front end answers: wait for it
  let r: Response;
  let body: Record<string, unknown>;
  for (let i = 0;; i++) {
    r = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
    });
    body = await r.json();
    if (body.error !== "backend_unreachable" || i >= 120) break;
    await new Promise((res) => setTimeout(res, 2_000));
  }
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
    body: JSON.stringify({ language: "en", name: "Leaf Owner" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

const NEW_SERVICE = "Leaf cleanup";

Deno.test("REQ-1159 (LOOP-007 q3-91): /field/tasks → Add task — a new service name offers '+ Add \"Leaf cleanup\" as a service', adds it to the catalogue and the task saves with it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const post = async (p: string, b: unknown) =>
      (await http(p, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(b),
      }))
        .json();
    await post("/api/customers", {
      name: "Ana Torres",
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      email: "ana.torres@blackhole.postmarkapp.com",
    });
    const worker = await post("/api/field/workers", {
      name: "Luis Herrera",
      phoneNumber: `843${digits()}`,
      pin: "1234",
    });

    await page.goto("/field/tasks");
    const form = page.locator("[data-cy='tk-add-form']");
    await clickUntil(page, "[data-cy='tk-add']", () => form.isVisible());
    await form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-input']",
    ).fill("Ana");
    await form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-option']",
    ).filter({ hasText: "Ana Torres" }).first().click();

    // the Service box is the house picker: typing a name that matches nothing offers to add it
    const svc = "[data-cy='tk-add-form'] [data-cy='tk-add-type']";
    const box = page.locator(`${svc} [data-cy='search-select-input']`);
    expect.eq(
      await box.count(),
      1,
      "the Add task Service box is a search picker (search-select-input), like the repeat-visit form",
    );
    await box.fill(NEW_SERVICE);
    const create = page.locator(`${svc} [data-cy='search-select-create']`);
    await create.waitFor({ timeout: 10_000 }).catch(() => {});
    expect.eq(
      await create.count(),
      1,
      `typing "${NEW_SERVICE}" shows the create row`,
    );
    expect.eq(
      (await create.innerText()).trim(),
      `+ Add "${NEW_SERVICE}" as a service`,
      "the create row reads like the repeat-visit form's",
    );

    // click it: the service is in the catalogue and is the box's pick
    await create.click();
    let listed: Array<{ id: string; name: string }> = [];
    for (let i = 0; i < 30; i++) {
      listed = await (await http("/api/field/task-types", { headers: auth }))
        .json();
      if (listed.some((x) => x.name === NEW_SERVICE)) break;
      await page.waitForTimeout(300);
    }
    const made = listed.find((x) => x.name === NEW_SERVICE);
    expect(!!made, `GET /api/field/task-types lists "${NEW_SERVICE}"`);
    await page.waitForFunction(
      ([sel, id]) =>
        document.querySelector(sel)?.getAttribute("data-value") === id,
      [svc, made!.id] as const,
      { timeout: 10_000 },
    );
    expect.eq(
      await box.inputValue(),
      NEW_SERVICE,
      "the Service box shows the new service",
    );

    await form.locator("[data-cy='tk-add-price']").fill("85");
    await form.locator("[data-cy='tk-add-worker']").selectOption(worker.id);
    const saved = page.waitForResponse((r) =>
      r.url().includes("/api/field/tasks") && r.request().method() === "POST"
    );
    await form.locator("[data-cy='tk-add-save']").click();
    const res = await saved;
    expect(
      res.ok(),
      `the task is created (POST /api/field/tasks → ${res.status()})`,
    );
    await page.locator("[data-cy='tk-task'][data-oneoff='true']").first()
      .waitFor({ timeout: 15_000 });
    await expect.see(NEW_SERVICE);
    await expect.see("$85.00");
  }));
