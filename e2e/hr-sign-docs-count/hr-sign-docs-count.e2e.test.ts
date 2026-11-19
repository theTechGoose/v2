/**
 * REQ-1155 (LOOP-007 q3, q3-87) — /sign/:token's intro line counts the packet's documents with
 * the right noun. A hire whose department packet holds ONE document reads "· 1 documento" in
 * Spanish and "· 1 document" in English — never "1 documentos" / "1 documents". Two documents
 * keep the plural.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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
    body: JSON.stringify({ businessName: "Monster Reservations Group" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  await page.context().addCookies([{ name, value, url: baseUrl }]);
  return { auth, phone };
}

async function hireWithDocs(
  http: StoryTools["http"],
  auth: Record<string, string>,
  nDocs: number,
): Promise<string> {
  const docIds: string[] = [];
  for (let k = 0; k < nDocs; k++) {
    const doc = await (await http("/api/hr/documents", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: `Policy ${k + 1}`,
        kind: "sign",
        contentHtml: "<p>Policy.</p>",
      }),
    })).json();
    if (!doc.id) throw new Error(`no document: ${JSON.stringify(doc)}`);
    docIds.push(doc.id);
  }
  const dept = await (await http("/api/hr/departments", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: "Field crew", division: "outbound" }),
  })).json();
  if (!dept.id) throw new Error(`no department: ${JSON.stringify(dept)}`);
  await (await http(`/api/hr/departments/${dept.id}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ docIds }),
  })).body?.cancel();
  const hire = await (await http("/api/hr/hires", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      firstName: "Marcus",
      email: "marcus@example.com",
      departmentId: dept.id,
    }),
  })).json();
  if (!hire.token) throw new Error(`no hire: ${JSON.stringify(hire)}`);
  return hire.token as string;
}

async function introLine(page: StoryTools["page"], token: string, lang: string) {
  await page.context().clearCookies();
  await page.goto(`/sign/${token}?lang=${lang}`);
  await page.locator("[data-cy='hrs-start']").waitFor({ timeout: 15_000 });
  await page.locator("[data-cy='hrs-intro-list'] li").first().waitFor({
    timeout: 15_000,
  });
  return ((await page.locator("[data-cy='hrs-card']").textContent()) ?? "")
    .replace(/\s+/g, " ");
}

for (const [lang, one, wrong] of [
  ["es", "1 documento", "1 documentos"],
  ["en", "1 document", "1 documents"],
] as const) {
  Deno.test(`REQ-1155 (LOOP-007 q3, q3-87): a one-document packet on /sign in ${lang} reads "· ${one}", not "${wrong}"`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const owner = await signIn(http, page, baseUrl);
      const token = await hireWithDocs(http, owner.auth, 1);
      const text = await introLine(page, token, lang);
      expect.eq(
        text.includes(wrong),
        false,
        `REQ-1155: no plural noun for one document — card text: ${text}`,
      );
      expect.eq(
        new RegExp(`· ${one}(?!s)`).test(text),
        true,
        `REQ-1155: the intro line reads "· ${one}" — card text: ${text}`,
      );
    }));
}

Deno.test("REQ-1155 (LOOP-007 q3, q3-87): a two-document packet on /sign in es keeps the plural '· 2 documentos'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const owner = await signIn(http, page, baseUrl);
    const token = await hireWithDocs(http, owner.auth, 2);
    const text = await introLine(page, token, "es");
    expect.eq(
      text.includes("· 2 documentos"),
      true,
      `REQ-1155: two documents keep the plural — card text: ${text}`,
    );
  }));
