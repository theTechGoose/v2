/**
 * REQ-1040 (LOOP-007 cycle 2, q2-24) — on /field/services a service used by ONE repeat visit
 * and ONE checklist reads "Used by 1 repeat visit · 1 checklist" (singular), in sentence case
 * (no uppercase chip that turns the Spanish "En" into the "EN" badge); in Spanish it says
 * "visita repetida" (REQ-743's name), never "visitas periódicas", and does not lead with "En".
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
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  const setLang = async (lang: "en" | "es") => {
    await (await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: lang, name: "Hank Field" }),
    })).body?.cancel();
    await page.context().addCookies([...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]));
  };
  await setLang("en");
  return { auth, setLang };
}

/** the company's day — the backend's FIELD_TZ default (America/New_York) */
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

Deno.test("REQ-1040 (LOOP-007 q2-24): a service used by 1 repeat visit and 1 checklist reads 'Used by 1 repeat visit · 1 checklist' in sentence case; in Spanish it says 'visita repetida', not 'visitas periódicas', and never leads with 'En'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, setLang } = await signIn(http, page, baseUrl);
    const api = async (method: string, path: string, body?: unknown) => {
      const r = await http(path, {
        method,
        headers: auth,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
      return await r.json();
    };
    const mulch = await api("POST", "/api/field/task-types", { name: "Mulching" });
    await api("POST", "/api/field/checklists", {
      name: "Spring beds",
      items: [{ taskTypeId: mulch.id, priceCents: 12_000 }],
    });
    const customer = await api("POST", "/api/customers", {
      name: "Ana Torres",
      phoneNumber: `(843) 555-${digits().slice(0, 4)}`,
      email: "ana@blackhole.postmarkapp.com",
    });
    await api("POST", "/api/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: todayIso(),
      items: [{ taskTypeId: mulch.id, priceCents: 12_000 }],
    });

    const line = page.locator("[data-cy='svc-used-by']").first();
    // text and look read in ONE evaluate so they come from the same render
    const read = () =>
      line.evaluate((el) => ({
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
        shown: (el as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
        transform: getComputedStyle(el).textTransform,
      }));

    await page.goto("/field/services");
    await line.waitFor({ timeout: 20_000 });
    let got = await read();
    for (let i = 0; i < 40 && !/\b1\b.*\b1\b/.test(got.text); i++) {
      await page.waitForTimeout(250); // the counts come with the catalogue fetch
      got = await read();
    }
    expect.eq(
      got.text,
      "Used by 1 repeat visit · 1 checklist",
      "EN used-by line is singular for a count of 1",
    );
    expect.eq(
      got.transform,
      "none",
      "the used-by sentence is not uppercased like a status chip",
    );

    await setLang("es");
    await page.goto("/field/services");
    await line.waitFor({ timeout: 20_000 });
    got = await read();
    for (let i = 0; i < 40 && !/visita/i.test(got.text); i++) {
      await page.waitForTimeout(250);
      got = await read();
    }
    expect(
      /\b1 visita repetida\b/.test(got.text),
      `ES used-by line says "1 visita repetida" (got "${got.text}")`,
    );
    expect(
      !/peri[óo]dica/i.test(got.text),
      `ES used-by line never says "periódica" (got "${got.text}")`,
    );
    expect(
      !/^EN\b/.test(got.shown),
      `ES used-by line does not lead with an "EN" that reads as the language badge (shown "${got.shown}")`,
    );
  }));
