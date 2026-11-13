/**
 * REQ-497 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3, issue m23: "Documents mix languages (… English
 * job names on the Spanish dashboard)". The Active jobs row rendered the
 * quote's primary `summary` and the Quotes awaiting row `q.summary`, so a job
 * written in English stayed English on the Spanish dashboard while /quotes
 * (REQ-394) already showed its Spanish name.
 *
 * A Spanish contractor has one signed job and one sent quote, both written in
 * English with Spanish names on file. /dashboard in Spanish shows the Spanish
 * names in both rows — never the English summaries.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signInSpanish(
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "es" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]),
  );
  return auth;
}

Deno.test("REQ-497 (demo m23): the Spanish dashboard names an English job and an English quote in Spanish", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signInSpanish(http, page, baseUrl);
    await answerQuestions(http, auth, {
      name: "Dora Dashboard",
      businessName: "Dora Remodels",
    });
    const post = async (path: string, payload: unknown) => {
      const res = await http(path, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`${path}: ${res.status} ${await res.text()}`);
      }
      return await res.json();
    };
    const maria = await post("/api/customers", { name: "Maria Lopez" });
    const ana = await post("/api/customers", { name: "Ana Ruiz" });
    await post("/api/quotes", {
      customerId: maria.id,
      summary: "Bathroom remodel — Maria Lopez",
      jobName: "Bathroom Remodel",
      jobNameByLang: { en: "Bathroom Remodel", es: "Remodelación de baño" },
      lineItems: [],
      estimatedTotal: 9_600_00,
      status: "accepted",
      sentAt: new Date(Date.now() - 86_400_000).toISOString(),
      acceptedAt: new Date().toISOString(),
    });
    const fence = await post("/api/quotes", {
      customerId: ana.id,
      summary: "Fence repair — Ana Ruiz",
      jobName: "Fence Repair",
      jobNameByLang: { en: "Fence Repair", es: "Reparación de cerca" },
      lineItems: [],
      estimatedTotal: 1_200_00,
    });
    // a create is a draft; the PUT is what marks it sent
    await (await http(`/api/quotes/${fence.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent" }),
    })).body?.cancel();

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/dashboard");
    await page.waitForFunction(
      () => {
        const t = document.body.innerText;
        return t.includes("Maria Lopez") && t.includes("Ana Ruiz");
      },
      undefined,
      { timeout: 20_000 },
    ).catch(async (err) => {
      throw new Error(
        `dashboard never listed both customers: ${err}\n${await page
          .locator("body").innerText()}`,
      );
    });
    const body = await page.locator("body").innerText();
    expect(
      body.includes("Remodelación de baño"),
      "the job row names the job in Spanish",
    );
    expect(
      body.includes("Reparación de cerca"),
      "the quote row names the quote in Spanish",
    );
    expect(
      !/Bathroom remodel|Fence repair/i.test(body),
      "no English job name on the Spanish dashboard",
    );
  }));
