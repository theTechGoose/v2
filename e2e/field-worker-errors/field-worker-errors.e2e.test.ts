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

/**
 * REQ-1015 (LOOP-007 q1, q1-101) — Remove access on a worker who still covers a zone refuses
 * straight away, in words naming the zone, without first asking "Remove {name}'s access?" and
 * without sending DELETE. A worker with no zones still gets the confirm step and is removed.
 */
Deno.test("REQ-1015 (LOOP-007 q1-101): Remove access on a worker who covers a zone refuses at once — no confirm step, no DELETE — while a worker with no zones still confirms and is removed", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const mk = async (name: string) => {
      const r = await http("/api/field/workers", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          name,
          phoneNumber: `843${digits()}`,
          pin: "1234",
        }),
      });
      expect(r.status === 201, `${name} created (${r.status})`);
      return (await r.json()) as { id: string };
    };
    const zoned = await mk("Luis Herrera");
    const free = await mk("Ana Free");
    const cust = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Zone Owner" }),
    })).json();
    const sub = await (await http("/api/field/subscriptions", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: cust.id,
        address: "900 Broadway St, Myrtle Beach, SC",
        items: [{ taskTypeName: "Cut", priceCents: 100 }],
      }),
    })).json();
    expect(!!sub?.region?.id, `the subscription has a zone (${JSON.stringify(sub)})`);
    const zr = await http(`/api/field/regions/${sub.region.id}/worker`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ workerId: zoned.id }),
    });
    expect(zr.ok, `zone assigned to Luis (${zr.status})`);
    await zr.body?.cancel();
    const zone = String(sub.region.name).replace(/^Zona /, "Zone ");

    const deletes: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "DELETE" && /\/field\/workers\//.test(r.url())) {
        deletes.push(r.url());
      }
    });

    await page.goto("/field/workers");
    const row = page.locator(`[data-cy='wk-row'][data-id='${zoned.id}']`);
    await row.waitFor({ timeout: 20_000 });
    await row.locator("[data-cy='wk-delete']").click();
    const err = row.locator("[data-cy='wk-row-error']");
    await err.waitFor({ timeout: 5_000 }).catch(() => {});
    const seen = await row.evaluate((el) => ({
      confirm: !!el.querySelector("[data-cy='wk-delete-confirm']"),
      text: el.textContent ?? "",
      err: el.querySelector("[data-cy='wk-row-error']")?.textContent?.trim() ??
        null,
    }));
    expect(
      !seen.confirm,
      `no "Remove Luis Herrera's access?" confirm step for a worker who covers ${zone} (row: ${seen.text})`,
    );
    expect(
      !/Remove Luis Herrera.s access\?/.test(seen.text),
      `the confirm question is not asked (row: ${seen.text})`,
    );
    expect.eq(
      seen.err,
      `This worker still covers ${zone}. Reassign those zones in Assignments first.`,
      "the refusal shows right away, naming the zone",
    );
    expect.eq(deletes.length, 0, "no DELETE was sent for a refusal the page already knew");

    // a worker with no zones still gets the confirm step, and Confirm removes them
    const freeRow = page.locator(`[data-cy='wk-row'][data-id='${free.id}']`);
    await freeRow.locator("[data-cy='wk-delete']").click();
    const confirm = freeRow.locator("[data-cy='wk-delete-confirm']");
    await confirm.waitFor({ timeout: 5_000 });
    const del = page.waitForResponse((r) =>
      r.request().method() === "DELETE" && r.url().includes(free.id)
    );
    await confirm.click();
    expect((await del).ok(), "the zone-free worker's DELETE succeeds");
    await freeRow.waitFor({ state: "detached", timeout: 10_000 });
  }));

/**
 * REQ-1062 (LOOP-007 q2, q2-51) — the REQ-1015 "This worker still covers Zone A …" refusal is
 * feedback for the Remove click, not a lasting state: saving a new crew, or marking someone
 * out, clears it from the worker's card.
 */
async function zonedWorkerRefused(
  { page, expect, http, baseUrl }: StoryTools,
) {
  const { auth } = await signIn(http, page, baseUrl);
  const mk = async (name: string) => {
    const r = await http("/api/field/workers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name, phoneNumber: `843${digits()}`, pin: "1234" }),
    });
    expect(r.status === 201, `${name} created (${r.status})`);
    return (await r.json()) as { id: string };
  };
  const zoned = await mk("Jake Zone");
  const free = await mk("Ana Free");
  const cust = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: "Zone Owner" }),
  })).json();
  const sub = await (await http("/api/field/subscriptions", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: cust.id,
      address: "900 Broadway St, Myrtle Beach, SC",
      items: [{ taskTypeName: "Cut", priceCents: 100 }],
    }),
  })).json();
  expect(!!sub?.region?.id, `the subscription has a zone (${JSON.stringify(sub)})`);
  const zr = await http(`/api/field/regions/${sub.region.id}/worker`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ workerId: zoned.id }),
  });
  expect(zr.ok, `zone assigned to Jake (${zr.status})`);
  await zr.body?.cancel();

  await page.goto("/field/workers");
  const row = page.locator(`[data-cy='wk-row'][data-id='${zoned.id}']`);
  await row.waitFor({ timeout: 20_000 });
  await row.locator("[data-cy='wk-delete']").click();
  const err = row.locator("[data-cy='wk-row-error']");
  await err.waitFor({ timeout: 10_000 });
  expect(
    /still covers/.test(await err.innerText()),
    "the REQ-1015 coversZones refusal shows after Remove",
  );
  return { row, err, free };
}

Deno.test("REQ-1062 (LOOP-007 q2-51): the 'still covers Zone A' refusal is gone from the worker card after a new crew is saved", (t) =>
  story(t, async (tools) => {
    const { page, expect } = tools;
    const { err } = await zonedWorkerRefused(tools);

    await page.locator("[data-cy='crew-new']").click();
    const form = page.locator("[data-cy='crew-form']");
    await form.waitFor({ timeout: 10_000 });
    await page.locator("[data-cy='crew-name']").fill("Crew Q2");
    const saved = page.waitForResponse((r) =>
      r.request().method() === "POST" && /\/field\/crews/.test(r.url())
    );
    await page.locator("[data-cy='crew-submit']").click();
    expect((await saved).ok(), "the crew is created");
    await form.waitFor({ state: "detached", timeout: 10_000 });
    await page.locator("[data-cy='crew-card-name']", { hasText: "Crew Q2" })
      .waitFor({ timeout: 10_000 });

    const left = await err.count() === 0 ? null : await err.innerText();
    expect(
      left === null,
      `no wk-row-error on the worker's card after the crew is saved (still shows: ${left})`,
    );
  }));

Deno.test("REQ-1062 (LOOP-007 q2-51): the 'still covers Zone A' refusal is gone from the worker card after another worker is marked out", (t) =>
  story(t, async (tools) => {
    const { page, expect } = tools;
    const { err, free } = await zonedWorkerRefused(tools);

    const freeRow = page.locator(`[data-cy='wk-row'][data-id='${free.id}']`);
    await freeRow.locator("[data-cy='wk-away']").click();
    const form = page.locator("[data-cy='away-form']");
    await form.waitFor({ timeout: 10_000 });
    await page.locator("[data-cy='away-disp-skip']").check();
    const saved = page.waitForResponse((r) =>
      r.request().method() === "POST" && /\/field\/absences/.test(r.url())
    );
    await page.locator("[data-cy='away-submit']").click();
    expect((await saved).ok(), "the absence is saved");
    await form.waitFor({ state: "detached", timeout: 10_000 });
    await page.locator("[data-cy='away-row']").first().waitFor({
      timeout: 10_000,
    });

    const left = await err.count() === 0 ? null : await err.innerText();
    expect(
      left === null,
      `no wk-row-error on the worker's card after marking a worker out (still shows: ${left})`,
    );
  }));

/**
 * REQ-1165 (LOOP-007 q3, q3-98) — the owner removes a worker's access on /field/workers; that
 * worker then signs in on /worker in Spanish. A wrong PIN reads "Celular o PIN incorrecto." (the
 * field is "Tu celular", not a "Trabajador"); the right cell + PIN reads "Tu acceso fue quitado…",
 * never "Trabajador o PIN incorrecto."
 */
Deno.test("REQ-1165 (LOOP-007 q3-98): a removed worker signing in on /worker in Spanish is told the access was removed; a wrong PIN reads 'Celular o PIN incorrecto.'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const cell = `843${digits()}`;
    const r = await http("/api/field/workers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Maya Chen", phoneNumber: cell, pin: "1111" }),
    });
    expect(r.status === 201, `worker created (${r.status})`);
    const maya = (await r.json()) as { id: string };

    // the owner presses Remove access → Confirm
    await page.goto("/field/workers");
    const row = page.locator(`[data-cy='wk-row'][data-id='${maya.id}']`);
    await row.waitFor({ timeout: 20_000 });
    await row.locator("[data-cy='wk-delete']").click();
    const confirm = row.locator("[data-cy='wk-delete-confirm']");
    await confirm.waitFor({ timeout: 5_000 });
    const del = page.waitForResponse((x) =>
      x.request().method() === "DELETE" && x.url().includes(maya.id)
    );
    await confirm.click();
    expect((await del).ok(), "Remove access succeeds");
    await row.waitFor({ state: "detached", timeout: 10_000 });

    // the worker's phone, in Spanish
    await page.context().addCookies([
      ...new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]),
    ].map((domain) => ({ name: "pm_lang", value: "es", domain, path: "/" })));
    await page.goto("/worker?lang=es");
    const tryLogin = async (pin: string) => {
      await page.locator("[data-cy='w-cell']").fill(cell);
      await page.locator("[data-cy='w-pin']").fill(pin);
      const res = page.waitForResponse((x) =>
        x.request().method() === "POST" && x.url().includes("/field/worker/login")
      );
      await page.locator("[data-cy='w-login']").click();
      await res;
      const err = page.locator("[data-cy='w-error']");
      await err.waitFor({ timeout: 10_000 });
      return (await err.innerText()).trim();
    };
    await page.locator("[data-cy='w-cell']").waitFor({ timeout: 20_000 });

    const wrong = await tryLogin("9999");
    expect.eq(wrong, "Celular o PIN incorrecto.", "a wrong PIN names the cell, not a 'Trabajador'");

    const right = await tryLogin("1111");
    expect.eq(
      right,
      "Tu acceso fue quitado. Habla con tu oficina.",
      "the right cell + PIN of a removed worker says the access was removed",
    );
    expect(!/Trabajador o PIN/.test(right), `never "Trabajador o PIN incorrecto." (${right})`);
  }));
