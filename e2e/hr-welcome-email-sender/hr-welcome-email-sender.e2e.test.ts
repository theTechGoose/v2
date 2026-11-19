/**
 * REQ-1036 — LOOP-007 cycle 2, issue q2-19: "HR catalog says the welcome email comes 'from
 * DocuMonster', but the fix sends it from the business". REQ-1003 made the new-hire invite come
 * from the hiring business; the Settings › Systems catalog card for the "Welcome email (Postmark)"
 * arm (dm-email) still reads "A welcome note with the handbook portal's login, from DocuMonster".
 * In a browser: /settings?tab=systems — the welcome-email catalog card does not say DocuMonster,
 * and once attached, the attached system's card does not either.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<string> {
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
  await (await http("/api/me", {
    method: "PUT",
    headers: { ...JSON_HEADERS, cookie },
    body: JSON.stringify({ language: "en", name: "Welcome Sender Story" }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: { ...JSON_HEADERS, cookie },
    body: JSON.stringify({ businessName: "Reyes Tile & Bath" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return cookie;
}

/** the description line(s) of the card of kind `cy` that names `name`, or null */
const cardText = (page: StoryTools["page"], cy: string, name: string) =>
  page.evaluate(([cy, name]) => {
    const cards = [
      ...document.querySelectorAll<HTMLElement>(`[data-cy='${cy}']`),
    ];
    const card = cards.find((c) => c.innerText.includes(name));
    if (!card) return null;
    // the card's description line only — its "Built into DocuMonster" badge is right
    return [...card.querySelectorAll<HTMLElement>(".hr-sys__desc")].map((d) =>
      d.innerText
    ).join(" | ");
  }, [cy, name] as const);

Deno.test("REQ-1036 (LOOP-007 q2-19): /settings?tab=systems — the 'Welcome email (Postmark)' card does not say the note comes from DocuMonster, catalog or attached", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const cookie = await signIn(http, page, baseUrl);

    await page.goto("/settings?tab=systems&lang=en");
    await page.locator("[data-cy='hr-catalog-card']").first().waitFor({
      timeout: 30_000,
    });
    const catalog = await cardText(page, "hr-catalog-card", "Welcome email");
    expect(catalog !== null, "the catalog has a 'Welcome email' card");
    expect(
      !/documonster/i.test(catalog ?? ""),
      `the catalog card says the welcome note is from DocuMonster: ${
        JSON.stringify(catalog)
      }`,
    );

    // attached: the system's stored desc is what the attached card shows
    const att = await http("/api/hr/systems", {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie },
      body: JSON.stringify({ key: "dm-email" }),
    });
    expect.eq(att.status, 201, "dm-email attaches");
    await att.body?.cancel();
    await page.goto("/settings?tab=systems&lang=en");
    await page.locator("[data-cy='hr-sys-card']").first().waitFor({
      timeout: 30_000,
    });
    const attached = await cardText(page, "hr-sys-card", "Welcome email");
    expect(attached !== null, "the attached 'Welcome email' card shows");
    expect(
      !/documonster/i.test(attached ?? ""),
      `the attached card says the welcome note is from DocuMonster: ${
        JSON.stringify(attached)
      }`,
    );
  }));
