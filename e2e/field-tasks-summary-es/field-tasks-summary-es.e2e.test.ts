/**
 * REQ-1167 (LOOP-007 q3, q3-99) — the owner Tasks page in Spanish: with the day's one task checked
 * off, the summary row's day header is capitalised like the worker screen ("Jue 19 de nov",
 * REQ-1065's fmtDayLabel) and the counters are plural labels in front of a number
 * ("Completadas 1 · Pendientes 0"), never the single task's status "Completada 1".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** the company's day — the backend's FIELD_TZ default (America/New_York) */
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

async function spanishOwner(
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
    body: JSON.stringify({ language: "es", name: "Dueña Tareas" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]),
  );
  const call = async (method: string, path: string, b?: unknown) => {
    const res = await http(path, {
      method,
      headers: auth,
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
  return { call };
}

Deno.test("REQ-1167 (LOOP-007 q3-99): /field/tasks?lang=es with one completed task — the day header is capitalised like fmtDayLabel and the done chip reads 'Completadas 1'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { call } = await spanishOwner(http, page, baseUrl);
    const today = todayIso();
    const customer = await call("POST", "/api/customers", {
      name: "Ana Torres",
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      email: "ana.torres@blackhole.postmarkapp.com",
    });
    const worker = await call("POST", "/api/field/workers", {
      name: "Luis Herrera",
      phoneNumber: `843${digits()}`,
      pin: "1234",
    });
    const sub = await call("POST", "/api/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: today,
      items: [{ taskTypeName: "Corte de césped", priceCents: 6500 }],
    });
    await call("PUT", `/api/field/regions/${sub.region.id}/worker`, {
      workerId: worker.id,
    });
    const tasks = await call("GET", `/api/field/tasks?date=${today}`);
    const list = Array.isArray(tasks) ? tasks : tasks.tasks ?? tasks.items;
    expect.eq(list.length, 1, "the day has one task");
    await call("PUT", `/api/field/tasks/${list[0].id}`, { status: "complete" });

    await page.goto("/field/tasks?lang=es");
    await page.locator("[data-cy='tk-task'][data-status='complete']").first()
      .waitFor({ timeout: 20_000 });
    // one evaluate: the header, the chips and the expected label read against one render
    const seen = await page.evaluate((iso) => {
      const row = document.querySelector("[data-cy='tk-summary']");
      const spans = [...(row?.querySelectorAll(":scope > span") ?? [])].map(
        (s) => (s.textContent ?? "").replace(/\s+/g, " ").trim(),
      );
      const plain = new Date(`${iso}T00:00:00`).toLocaleDateString("es-MX", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      return {
        spans,
        label: plain.charAt(0).toUpperCase() + plain.slice(1),
      };
    }, today);
    const [day, doneChip, toDoChip] = seen.spans;
    expect.eq(
      day,
      seen.label,
      `the day header is the capitalised label (${JSON.stringify(seen.spans)})`,
    );
    expect.eq(
      /^[A-ZÁÉÍÓÚÑ]/.test(day ?? ""),
      true,
      `the day header starts with a capital: ${day}`,
    );
    expect.eq(doneChip, "Completadas 1", "the done chip is plural");
    expect.eq(toDoChip, "Pendientes 0", "the to-do chip is plural");
  }));
