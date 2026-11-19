/**
 * REQ-1035 (+ REQ-1011) — LOOP-007 cycle 2, QA issues q2-17 and q2-50: an empty /worker day
 * says it is empty exactly once, at 390x844.
 *  q2-50: a worker with nothing tomorrow (EN and ES) sees no "🔒 Preview — you can check these
 *         off on the day." hint and no second `w-empty` card under the summary's "No tasks this
 *         day / Nothing scheduled.".
 *  q2-17: a crew foreman (ES) with nothing today sees no "Mis tareas 0/0" chip and no third
 *         "Sin tareas este día." card under "Sin tareas hoy / Nada programado.".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** the company's day — the backend's FIELD_TZ default (America/New_York) */
const nyIso = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
const todayIso = () => nyIso(new Date());
const tomorrowIso = () => {
  const d = new Date(`${todayIso()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

async function owner(http: StoryTools["http"]) {
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
  if (!cookie) throw new Error(`sign-in: no session (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ name: "Empty Day Story" }),
  });
  await me.body?.cancel();
  return auth;
}

async function addWorker(
  http: StoryTools["http"],
  auth: Record<string, string>,
  b: { name: string; language: "en" | "es"; role?: "foreman" },
) {
  const cell = `843${digits()}`;
  const r = await http("/api/field/workers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ ...b, phoneNumber: cell, pin: "1234" }),
  });
  const w = await r.json();
  if (!w?.id) throw new Error(`worker: ${JSON.stringify(w)}`);
  return cell;
}

/** sign in on /worker in `lang`, open `date`, and read the whole day in one evaluate */
async function readDay(
  { page, baseUrl }: Pick<StoryTools, "page" | "baseUrl">,
  cell: string,
  lang: "en" | "es",
  date: string,
) {
  await page.context().clearCookies();
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].map((domain) => ({
      name: "pm_lang",
      value: lang,
      domain,
      path: "/",
    })),
  );
  await page.goto(`/worker?lang=${lang}`);
  await page.locator("[data-cy='w-cell']").fill(cell);
  await page.locator("[data-cy='w-pin']").fill("1234");
  await page.locator("[data-cy='w-login']").click();
  await page.locator("[data-cy='w-summary']").waitFor({ timeout: 15_000 });
  if (date !== todayIso()) {
    await page.goto(`/worker?date=${date}&lang=${lang}`);
    await page.waitForURL(new RegExp(`date=${date}`), { timeout: 15_000 });
  }
  await page.locator("[data-cy='w-summary']").waitFor({ timeout: 15_000 });
  return await page.evaluate(() => {
    const txt = (el: Element | null) =>
      (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const all = (sel: string) => [...document.querySelectorAll(sel)].map(txt);
    return {
      summary: txt(document.querySelector("[data-cy='w-summary']")),
      count: txt(document.querySelector("[data-cy='w-count']")),
      preview: document.querySelectorAll("[data-cy='w-preview']").length,
      wEmpty: document.querySelectorAll("[data-cy='w-empty']").length,
      empties: all(".wrap .empty"),
      counts: all(".wrap .crew .count, .wrap .count"),
      visits: document.querySelectorAll("[data-cy='w-visit']").length,
      // innerText skips the island's <style> block
      text:
        ((document.querySelector(".wrap") as HTMLElement | null)?.innerText ??
          "").replace(/\s+/g, " ").trim(),
    };
  });
}

type Day = Awaited<ReturnType<typeof readDay>>;

Deno.test("REQ-1035 (LOOP-007 q2-50, q2-17; REQ-1011): an empty /worker day at 390x844 says it once — no preview hint, no second empty card, no 'Mis tareas 0/0' chip", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const auth = await owner(http);
    const jake = await addWorker(http, auth, { name: "Jake", language: "en" });
    const rosa = await addWorker(http, auth, { name: "Rosa", language: "es" });
    const miguel = await addWorker(http, auth, {
      name: "Miguel",
      language: "es",
      role: "foreman",
    });

    // every half is checked before failing, so one run shows each fault
    const faults: string[] = [];
    const check = (ok: boolean, msg: string) => {
      if (!ok) faults.push(msg);
    };
    /** the summary's "none" line counts as one message; each `.empty` card is another */
    const emptyMessages = (d: Day, none: RegExp) =>
      (none.test(d.count) ? 1 : 0) + d.empties.length;

    // q2-50 — a plain worker, tomorrow, EN
    const tomorrow = tomorrowIso();
    const en = await readDay({ page, baseUrl }, jake, "en", tomorrow);
    check(en.visits === 0, `EN: tomorrow has no visits (got ${en.visits})`);
    check(
      en.preview === 0,
      `EN: no "🔒 Preview — you can check these off" hint on an empty day (got ${en.preview})`,
    );
    check(
      en.wEmpty === 0,
      `EN: no second [data-cy=w-empty] card under the summary (got ${en.wEmpty}: ${
        JSON.stringify(en.empties)
      })`,
    );
    check(
      (en.text.match(/No tasks this day/g) ?? []).length === 1,
      `EN: "No tasks this day" appears once (got ${
        (en.text.match(/No tasks this day/g) ?? []).length
      } in "${en.text.slice(0, 300)}")`,
    );
    check(
      emptyMessages(en, /No tasks/) === 1,
      `EN: exactly one empty message (summary "${en.count}", cards ${
        JSON.stringify(en.empties)
      })`,
    );

    // q2-50 — a plain worker, tomorrow, ES
    const es = await readDay({ page, baseUrl }, rosa, "es", tomorrow);
    check(es.visits === 0, `ES: tomorrow has no visits (got ${es.visits})`);
    check(
      es.preview === 0,
      `ES: no "Vista previa — podrás marcarlos ese día." hint on an empty day (got ${es.preview})`,
    );
    check(
      es.wEmpty === 0,
      `ES: no second [data-cy=w-empty] card under the summary (got ${es.wEmpty}: ${
        JSON.stringify(es.empties)
      })`,
    );
    check(
      emptyMessages(es, /Sin tareas/) === 1,
      `ES: exactly one empty message (summary "${es.count}", cards ${
        JSON.stringify(es.empties)
      })`,
    );

    // q2-17 — the crew foreman, today, ES
    const fm = await readDay({ page, baseUrl }, miguel, "es", todayIso());
    check(fm.visits === 0, `foreman: today has no visits (got ${fm.visits})`);
    check(
      !fm.counts.some((c) => /^0\s*\/\s*0$/.test(c)),
      `foreman: no ".count" chip reads "0/0" (got ${
        JSON.stringify(fm.counts)
      })`,
    );
    check(
      !fm.text.includes("Sin tareas este día."),
      `foreman: no "Sin tareas este día." card under "Sin tareas hoy" (page "${
        fm.text.slice(0, 300)
      }")`,
    );
    check(
      emptyMessages(fm, /Sin tareas/) === 1,
      `foreman: exactly one empty message (summary "${fm.count}", cards ${
        JSON.stringify(fm.empties)
      })`,
    );

    expect(faults.length === 0, faults.join(" | "));
  }));
