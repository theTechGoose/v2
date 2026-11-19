/**
 * REQ-1157 — LOOP-007 cycle 3, issue q3-89: "HR signing link has no ?lang, so it opens in the
 * phone's last-used language". An English owner adds a hire; the text and email go out in
 * English. The hire's phone last used DocuMonster in Spanish (pm_lang=es). Opening the signing
 * link the owner's hire file shows (the same link the text carries) must open /sign in English:
 * the link carries ?lang=en. Today the link is a bare /sign/<token> and the page opens in Spanish.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"]): Promise<string> {
  const phone = `+1512${digits()}`;
  // the backend may still be booting when the front-end answers: wait it out
  let r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
  });
  let body = await r.json();
  for (let i = 0; i < 120 && body.error === "backend_unreachable"; i++) {
    await new Promise((res) => setTimeout(res, 1_000));
    r = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
    });
    body = await r.json();
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      language: "en",
      name: "Sign Link Story",
      email: "sign-link-story@example.com",
    }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ businessName: "Reyes Lawn & Pool" }),
  })).body?.cancel();
  return cookie;
}

Deno.test("REQ-1157 (LOOP-007 q3-89): an English owner's signing link opens /sign in English on a phone whose pm_lang cookie is es", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const cookie = await signIn(http);
    const auth = { ...JSON_HEADERS, cookie };
    const post = async (path: string, body: unknown, method = "POST") => {
      const r = await http(path, {
        method,
        headers: auth,
        body: JSON.stringify(body),
      });
      const text = await r.text();
      if (r.status >= 300) throw new Error(`${path} → ${r.status} ${text}`);
      return JSON.parse(text);
    };
    const dept = await post("/api/hr/departments", {
      name: "Crew",
      division: "outbound",
    });
    const doc = await post("/api/hr/documents", {
      name: "Handbook",
      kind: "ack",
      contentHtml: "<p>Be kind.</p>",
    });
    await post(
      `/api/hr/departments/${dept.id}`,
      { docIds: [doc.id] },
      "PUT",
    );
    const hire = await post("/api/hr/hires", {
      firstName: "Rosa",
      lastName: "Diaz",
      phone: `702555${String(1000 + Math.floor(Math.random() * 9000))}`,
      email: "rosa@example.com",
      departmentId: dept.id,
    });
    const detailRes = await http(`/api/hr/hires/${hire.id}`, {
      headers: auth,
    });
    const detail = await detailRes.json();
    const signUrl = String(detail.signUrl ?? "");
    const link = new URL(signUrl);
    expect(
      link.pathname === `/sign/${hire.token}`,
      `the hire's signing link points at /sign/<token>: ${signUrl}`,
    );

    // the hire's phone: no owner session, last used DocuMonster in Spanish
    await page.context().clearCookies();
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].map((domain) => ({
        name: "pm_lang",
        value: "es",
        domain,
        path: "/",
      })),
    );
    await page.goto(`${link.pathname}${link.search}`);
    await page.locator("[data-cy='hrs-start']").waitFor({ timeout: 30_000 });
    const seen = await page.evaluate(() => ({
      htmlLang: document.documentElement.lang,
      title: document.title,
      body: document.body.innerText,
    }));
    expect(
      seen.htmlLang === "en" && seen.body.includes("Hi Rosa!"),
      `the English text's link opened /sign in ${
        JSON.stringify(seen.htmlLang)
      } (link ${signUrl}; title ${JSON.stringify(seen.title)})`,
    );
  }));
