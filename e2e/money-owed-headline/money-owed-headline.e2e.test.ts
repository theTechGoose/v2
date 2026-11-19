/**
 * REQ-957 — LOOP-007 cycle 1, issue q1-32: the dashboard said "MONEY OWED TO YOU $0" beside
 * "$4,650 1 open invoice". One sent invoice that is not yet due. A MutationObserver, installed
 * before the page's scripts run, records the headline and the open tile at every DOM commit;
 * from the commit where the open tile first shows $4,650, the headline must say the same — a
 * count-up from $0 (or a pending $0) must never stand beside the real amount.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

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
    body: JSON.stringify({ language: "en", name: "Owed Headline" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: Record<string, unknown>,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

const OPEN_AMT = "[data-cy='money-col'][data-bucket='open'] .moneybar__col-amt";

Deno.test("REQ-957 q1-32: the money-owed headline equals the open tile from the moment the lists land — never $0 beside $4,650", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { name: "Owed Headline" });
    const maria = await post(http, auth, "/api/customers", {
      name: "Maria Lopez",
    });
    await post(http, auth, "/api/invoices", {
      customerId: maria.id,
      status: "sent",
      jobName: "Kitchen repaint",
      amount: 465_000,
      issuedDate: daysFromNow(0),
      dueDate: daysFromNow(7),
    });

    // every DOM commit: what the headline and the open tile say at that instant
    await page.addInitScript((sel: string) => {
      const w = window as unknown as { __owed: [string, string][] };
      w.__owed = [];
      const snap = () => {
        const h = document.querySelector("[data-cy='money-owed']");
        const o = document.querySelector(sel);
        if (!h || !o) return;
        const pair: [string, string] = [
          (h.textContent ?? "").replace(/\s+/g, ""),
          (o.textContent ?? "").replace(/\s+/g, ""),
        ];
        const last = w.__owed[w.__owed.length - 1];
        if (!last || last[0] !== pair[0] || last[1] !== pair[1]) {
          w.__owed.push(pair);
        }
      };
      new MutationObserver(snap).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }, OPEN_AMT);

    await page.goto("/dashboard");
    // the durable signal: the lists have landed and the open tile shows the invoice
    await page.waitForFunction(
      (sel: string) =>
        (document.querySelector(sel)?.textContent ?? "").includes("4,650"),
      OPEN_AMT,
      { timeout: 20_000 },
    );
    const seen = await page.evaluate(() =>
      (window as unknown as { __owed: [string, string][] }).__owed
    );
    const landed = seen.findIndex(([, open]) => open === "$4,650");
    expect(
      landed >= 0,
      `the open tile reached $4,650 (${JSON.stringify(seen)})`,
    );
    const wrong = seen.slice(landed).filter(([owed, open]) => owed !== open);
    expect.eq(
      JSON.stringify(wrong),
      "[]",
      `headline vs open tile after the lists landed (all commits: ${
        JSON.stringify(seen)
      })`,
    );
  }));
