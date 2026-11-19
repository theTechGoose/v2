/**
 * REQ-1039 (LOOP-007 cycle 2, q2-23) — the Spanish dashboard's money bar read "Vence dic 4 ·
 * INV-001" while every other screen says "4 dic", and its paid line printed the browser's day
 * instead of the business's (REQ-944).
 *
 * A Spanish account whose business zone is New York, browsing from a phone set to Tokyo (CDP),
 * with an open invoice due 20 days out and an invoice paid at 03:30Z yesterday — still the day
 * before yesterday in New York, already yesterday in Tokyo. The open row must read
 * "Vence <d> <mes> · <num>" and the paid row "Cobrada <New York day> <mes> · <num>".
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => iso(new Date(Date.now() + n * 86_400_000));
const MESES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];
const BUSINESS_TZ = "America/New_York";
const BROWSER_TZ = "Asia/Tokyo";

/** "4 dic" for a calendar day YYYY-MM-DD */
const esDay = (ymd: string) => {
  const [, m, d] = ymd.split("-").map(Number);
  return `${d} ${MESES[m - 1]}`;
};
/** the calendar day of an instant in a zone, YYYY-MM-DD */
const dayIn = (instant: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));

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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "es", name: "Barra Dinero" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]),
  );
  return { auth };
}

async function send(
  http: StoryTools["http"],
  auth: Record<string, string>,
  method: string,
  path: string,
  body: Record<string, unknown>,
) {
  const r = await http(path, {
    method,
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
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

const list = "[data-cy='money-list']";
const meta = "[data-cy='money-row'] .moneybar__row-meta";

Deno.test("REQ-1039 q2-23: the Spanish money bar reads 'Vence <d> <mes>' on the open row and the paid row prints the business zone's day, with the browser in another zone", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { name: "Barra Dinero" });
    const ident = await send(http, auth, "PUT", "/api/profile/identity", {
      timezone: BUSINESS_TZ,
    });
    expect.eq(ident?.timezone, BUSINESS_TZ, "the business zone is saved");
    const rosa = await send(http, auth, "POST", "/api/customers", {
      name: "Rosa Delgado",
    });

    const due = daysFromNow(20);
    const open = await send(http, auth, "POST", "/api/invoices", {
      customerId: rosa.id,
      status: "sent",
      jobName: "Instalación de azulejo en baño",
      amount: 120_000,
      issuedDate: daysFromNow(0),
      dueDate: due,
    });
    // 03:30Z yesterday: the evening before in New York, the afternoon of in Tokyo
    const paidAt = `${daysFromNow(-1)}T03:30:00.000Z`;
    const paid = await send(http, auth, "POST", "/api/invoices", {
      customerId: rosa.id,
      status: "paid",
      paidAt,
      jobName: "Pintura de cocina",
      amount: 65_000,
      issuedDate: daysFromNow(-10),
      dueDate: daysFromNow(5),
    });
    const bizDay = dayIn(paidAt, BUSINESS_TZ);
    expect(
      bizDay !== dayIn(paidAt, BROWSER_TZ),
      `precondition: ${paidAt} is ${bizDay} in New York, ${
        dayIn(paidAt, BROWSER_TZ)
      } in Tokyo`,
    );

    // the browser runs in a zone that is not the business's
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTimezoneOverride", { timezoneId: BROWSER_TZ });

    await page.goto("/dashboard");
    await page.locator(`${list}[data-bucket='open']`).waitFor({
      timeout: 20_000,
    });
    expect.eq(
      await page.evaluate(() =>
        Intl.DateTimeFormat().resolvedOptions().timeZone
      ),
      BROWSER_TZ,
      "the browser is in Tokyo",
    );

    // 1. the open row: day before month, as on every other Spanish screen
    const openMeta = (await page.locator(meta).first().innerText()).trim();
    expect.eq(
      openMeta,
      `Vence ${esDay(due)} · ${open.number}`,
      "open row reads 'Vence <d> <mes> · <num>'",
    );

    // 2. the paid row: the business's day, not Tokyo's
    await clickUntil(
      page,
      "[data-cy='money-col'][data-bucket='paid']",
      async () =>
        (await page.locator(list).getAttribute("data-bucket")) === "paid",
    );
    const paidMeta = (await page.locator(meta).first().innerText()).trim();
    expect(
      paidMeta.startsWith(`Cobrada ${esDay(bizDay)} · ${paid.number}`),
      `paid row reads "Cobrada ${
        esDay(bizDay)
      } · ${paid.number}…" (got "${paidMeta}")`,
    );
  }));
