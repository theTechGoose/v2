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
 * REQ-1162 (LOOP-007 q3, q3-94) — amends REQ-421/REQ-1015. Remove access on a worker who has an
 * upcoming task: the row says so (names the task) before anything is removed, and afterwards the
 * day never shows that task under Worker "—" with status ASSIGNED.
 */
Deno.test("REQ-1162 (LOOP-007 q3-94): Remove access on a worker with an upcoming task names the task on the row, and the task is never left as Worker '—' + ASSIGNED", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const mr = await http("/api/field/workers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Maya Chen",
        phoneNumber: `843${digits()}`,
        pin: "1234",
      }),
    });
    expect(mr.status === 201, `Maya created (${mr.status})`);
    const maya = (await mr.json()) as { id: string };
    const grace = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Grace Whitfield",
        address: "12 Elm St, Myrtle Beach, SC",
      }),
    })).json();
    // one day ahead in UTC is today or later in any US account's own day — "upcoming" either way
    const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const tr = await http("/api/field/tasks", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: grace.id,
        date: day,
        taskTypeName: "Leaf cleanup",
        priceCents: 9000,
        workerId: maya.id,
      }),
    });
    expect(tr.status === 201, `Maya's task on ${day} created (${tr.status})`);
    await tr.body?.cancel();

    await page.goto("/field/workers");
    const row = page.locator(`[data-cy='wk-row'][data-id='${maya.id}']`);
    await row.waitFor({ timeout: 20_000 });
    await row.locator("[data-cy='wk-delete']").click();
    await row.locator("[data-cy='wk-delete-confirm'], [data-cy='wk-row-error']")
      .first().waitFor({ timeout: 5_000 }).catch(() => {});
    const seen = await row.evaluate((el) => ({
      confirm: !!el.querySelector("[data-cy='wk-delete-confirm']"),
      text: el.textContent ?? "",
    }));
    // the owner is told about the task before access goes
    const warned = /task|Grace Whitfield/i.test(seen.text);

    // go through with whatever the page offers, then read the day
    if (seen.confirm) {
      const del = page.waitForResponse(
        (r) => r.request().method() === "DELETE" && r.url().includes(maya.id),
        { timeout: 10_000 },
      ).catch(() => null);
      await row.locator("[data-cy='wk-delete-confirm']").click();
      await del;
    }
    const dr = await http(`/api/field/tasks?date=${day}`, { headers: auth });
    const tasks = (await dr.json()) as Array<
      { customerName: string; workerName: string; status: string }
    >;
    const orphans = tasks.filter((x) =>
      x.workerName === "—" && x.status === "assigned"
    );

    expect(
      warned,
      `the row names Maya's upcoming task before removing her (row: ${seen.text})`,
    );
    expect.eq(
      orphans.map((x) => x.customerName),
      [],
      `no task on ${day} is left under Worker "—" with status assigned`,
    );
  }));
