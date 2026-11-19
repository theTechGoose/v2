/**
 * REQ-1158 (LOOP-007 cycle 3, q3-90) — the hire's /sign page carries no whale emoji. The greeting
 * (hr.sign.hi) reads "Hi Rosa!" / "¡Hola Rosa!" and the brand slot shows the business's name, or a
 * neutral fallback when none is set — never the "Monster Onboarding" prototype's 🐋.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const PICTO = /\p{Extended_Pictographic}/u;

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
    body: JSON.stringify({
      language: "en",
      name: "HR Story",
      email: "hr-story@example.com",
    }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ businessName: "Reyes Lawn & Pool" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  await page.context().addCookies([{ name, value, url: baseUrl }]);
  return { auth, phone };
}

async function rosaToken(owner: { auth: Record<string, string> }, http: StoryTools["http"]) {
  const doc = await (await http("/api/hr/documents", {
    method: "POST",
    headers: owner.auth,
    body: JSON.stringify({
      name: "Offer Letter",
      kind: "sign",
      contentHtml: "<p>Offer.</p>",
    }),
  })).json();
  const dept = await (await http("/api/hr/departments", {
    method: "POST",
    headers: owner.auth,
    body: JSON.stringify({ name: "Pool crew" }),
  })).json();
  await (await http(`/api/hr/departments/${dept.id}`, {
    method: "PUT",
    headers: owner.auth,
    body: JSON.stringify({ docIds: [doc.id] }),
  })).body?.cancel();
  const hire = await (await http("/api/hr/hires", {
    method: "POST",
    headers: owner.auth,
    body: JSON.stringify({
      firstName: "Rosa",
      email: "rosa@example.com",
      departmentId: dept.id,
    }),
  })).json();
  if (!hire.token) throw new Error(`no hire: ${JSON.stringify(hire)}`);
  return hire.token as string;
}

for (
  const [lang, hi] of [["en", "Hi Rosa!"], ["es", "¡Hola Rosa!"]] as const
) {
  Deno.test(`REQ-1158 (LOOP-007 q3, q3-90): /sign in ${lang} greets "${hi}" with no whale, and the brand slot carries no emoji`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const owner = await signIn(http, page, baseUrl);
      const token = await rosaToken(owner, http);
      await page.context().clearCookies();

      // 1) with the business's name set
      await page.goto(`/sign/${token}?lang=${lang}`);
      await page.locator("[data-cy='hrs-hi']").waitFor({ timeout: 15_000 });
      const seen = await page.evaluate(() => ({
        hi: document.querySelector("[data-cy='hrs-hi']")?.textContent ?? "",
        brand: document.querySelector(".hrs__brand")?.textContent ?? "",
      }));
      expect.eq(
        PICTO.test(seen.hi),
        false,
        `REQ-1158: the ${lang} greeting carries no emoji — got "${seen.hi}"`,
      );
      expect.eq(
        seen.hi.trim(),
        hi,
        `REQ-1158: the ${lang} greeting reads "${hi}"`,
      );
      expect.eq(
        seen.brand.trim(),
        "Reyes Lawn & Pool",
        "REQ-1158: the brand slot names the business",
      );

      // 2) a packet with no company name: the brand slot falls back to something neutral
      await page.route(`**/api/hr/sign/${token}`, async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        const res = await route.fetch();
        const pk = await res.json();
        await route.fulfill({ response: res, json: { ...pk, companyName: "" } });
      });
      await page.goto(`/sign/${token}?lang=${lang}`);
      await page.locator("[data-cy='hrs-hi']").waitFor({ timeout: 15_000 });
      const brand = await page.evaluate(() =>
        document.querySelector(".hrs__brand")?.textContent ?? ""
      );
      expect.eq(
        PICTO.test(brand),
        false,
        `REQ-1158: with no company name the ${lang} brand slot shows no emoji — got "${brand}"`,
      );
    }));
}
