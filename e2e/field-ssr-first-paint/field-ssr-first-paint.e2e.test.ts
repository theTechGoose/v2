/**
 * REQ-730 (demo-loop cycle 5, issue c2-p13-p) — "Brief 'Loading…' lines
 * flash". The /field/* routes server-rendered their islands with no data, so
 * the first HTML held a "Loading…" line until the island hydrated and fetched
 * its list. The routes now load the lists server-side: the very first HTML
 * the server answers already carries the rows, and no "Loading…" line.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"]) {
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
    body: JSON.stringify({ language: "en", name: "Field First Paint" }),
  });
  await me.body?.cancel();
  return { auth, cookie };
}

Deno.test("REQ-730 (c2-p13-p, cycle 5): the first HTML of /field/workers carries the worker row and every /field/* list page has no 'Loading…' line", (t) =>
  story(t, async ({ expect, http }) => {
    const { auth, cookie } = await signIn(http);
    const w = await http("/api/field/workers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Ramona Firstpaint",
        phoneNumber: `737${digits()}`,
        pin: "7301",
        language: "es",
      }),
    });
    expect(
      w.status === 201 || w.status === 200,
      `worker created (${w.status})`,
    );
    await w.body?.cancel();

    const page = async (path: string) => {
      // The server's own answer — no browser, no JS, no hydration.
      const res = await http(path, {
        headers: { cookie: `${cookie}; pm_lang=en`, accept: "text/html" },
        redirect: "manual",
      });
      return { status: res.status, html: await res.text() };
    };

    const workers = await page("/field/workers");
    expect.eq(workers.status, 200, "/field/workers answers 200");
    expect(
      workers.html.includes('data-cy="wk-row"'),
      "the first HTML of /field/workers carries the worker row",
    );
    expect(
      workers.html.includes("Ramona Firstpaint"),
      "the row names the worker",
    );
    for (
      const path of [
        "/field/workers",
        "/field/assignments",
        "/field/subscriptions",
        "/field/batches",
        "/field/tasks",
      ]
    ) {
      const p = path === "/field/workers" ? workers : await page(path);
      expect.eq(p.status, 200, `${path} answers 200`);
      expect(
        !p.html.includes("Loading…") && !p.html.includes("Cargando…"),
        `${path}: the first HTML has no 'Loading…' line`,
      );
    }
  }));

/** the company's day — the backend's FIELD_TZ default (America/New_York) */
const companyToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

Deno.test("REQ-730 (c2-p13-p, cycle 5): after a pull, the first HTML of /field/batches carries the batch with its draft ticked", (t) =>
  story(t, async ({ expect, http }) => {
    const { auth, cookie } = await signIn(http);
    const call = async (method: string, path: string, data?: unknown) => {
      const res = await http(path, {
        method,
        headers: auth,
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
      return text ? JSON.parse(text) : null;
    };
    const today = companyToday();
    const customer = await call("POST", "/api/customers", {
      name: "Opal Batch",
      email: "opal.batch@blackhole.postmarkapp.com",
    });
    const worker = await call("POST", "/api/field/workers", {
      name: "Luis Firstpaint",
      phoneNumber: `843${digits()}`,
      pin: "1234",
    });
    const sub = await call("POST", "/api/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: today,
      items: [{ taskTypeName: "Lawn cut", priceCents: 6500 }],
    });
    await call("PUT", `/api/field/regions/${sub.region.id}/worker`, {
      workerId: worker.id,
    });
    const tasks = await call("GET", `/api/field/tasks?date=${today}`);
    expect.eq(tasks.length, 1, "one task today");
    await call("PUT", `/api/field/tasks/${tasks[0].id}`, {
      status: "complete",
    });
    await call("POST", "/api/field/batches/pull", { from: today, to: today });

    const res = await http("/field/batches", {
      headers: { cookie: `${cookie}; pm_lang=en`, accept: "text/html" },
      redirect: "manual",
    });
    const html = await res.text();
    expect.eq(res.status, 200, "/field/batches answers 200");
    expect(
      html.includes('data-cy="lt-past"'),
      "the first HTML lists the past batch",
    );
    expect(
      /<input[^>]*data-cy="lt-check"[^>]*checked/.test(html),
      "the first HTML carries the batch's draft, ticked",
    );
    expect(
      !html.includes("Loading…"),
      "no 'Loading…' line in the first HTML",
    );
  }));
