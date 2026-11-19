/**
 * REQ-1087 — LOOP-007 cycle 3, issue q3-4: one quote, one name, in the quote
 * email too.
 *
 * The chat model writes a quote's summary as "<job> — <customer>" (REQ-576)
 * and a separate jobName. The story seeds that exact pair through the API (the
 * summary text comes from the model, so a live LLM can't script it), sends the
 * quote email, and reads it back from the account's Outbox (GET /outbox/:id,
 * what /messages shows):
 *  - the email's heading (<h1>) is the subject's job part, word for word — not
 *    "Exterior Painting And Fence Staining — Maria Lopez";
 *  - the preheader names the customer once ("For Maria — <job> · $…"), never
 *    "… — Maria Lopez" on top;
 *  - /q's heading names the same job.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

type Row = { id: string; channel: string; kind: string; subject?: string };

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
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
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const call = async (path: string, payload: unknown, method = "POST") => {
    const res = await http(path, {
      method,
      headers: auth,
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
    }
    return json;
  };
  await call("/api/me", {
    name: "Marcus Reyes",
    email: `owner${digits()}@example.com`,
    language: lang,
  }, "PUT");
  await call("/api/profile/identity", {
    businessName: "Reyes Remodeling",
    commsLanguage: lang,
  }, "PUT");
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]),
  );
  return { auth, call };
}

const unescape = (s: string) =>
  s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();

const CASES = [
  {
    lang: "en" as const,
    customer: "Maria Lopez",
    jobName: "Exterior Painting & Fence Staining",
    summary: "Exterior painting and fence staining — Maria Lopez",
  },
  {
    lang: "es" as const,
    customer: "Lupe Garza",
    jobName: "Pintura exterior y tinte para cerca",
    summary: "Pintura exterior y tinte para cerca — Lupe Garza",
  },
];

for (const c of CASES) {
  Deno.test(`REQ-1087 (LOOP-007 q3, q3-4) ${c.lang}: a quote whose summary is '${c.summary}' and jobName '${c.jobName}' → the quote email's heading and preheader name the job as the subject and /q do, with no '— ${c.customer}' tail`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const s = await signIn(http, page, baseUrl, c.lang);
      const customer = await s.call("/api/customers", {
        name: c.customer,
        email: `c${digits()}@blackhole.postmarkapp.com`,
        language: c.lang,
      });
      const quote = await s.call("/api/quotes", {
        customerId: customer.id,
        summary: c.summary,
        jobName: c.jobName,
        lang: c.lang,
        lineItems: [
          {
            description: "Paint exterior",
            quantity: 1,
            unit: "job",
            price: 420_000,
          },
          {
            description: "Stain fence",
            quantity: 1,
            unit: "job",
            price: 180_000,
          },
        ],
        estimatedTotal: 600_000,
        status: "draft",
      });
      await s.call(`/api/quotes/${quote.id}/email`, {});

      let mail: Row | undefined;
      for (let i = 0; i < 20 && !mail; i++) {
        const rows = await (await http("/api/outbox", { headers: s.auth }))
          .json() as Row[];
        mail = rows.find((r) => r.kind === "quote" && r.channel === "email");
        if (!mail) await new Promise((r) => setTimeout(r, 500));
      }
      expect(!!mail, "the quote email is in the Outbox");
      const sent = await (await http(`/api/outbox/${mail!.id}`, {
        headers: s.auth,
      })).json() as { body: string; subject?: string };
      const subject = sent.subject ?? mail!.subject ?? "";
      const subjectJob = subject.split(" — ").at(-1)!.trim();
      expect.eq(
        subjectJob,
        c.jobName,
        "the subject names the job by its job name",
      );

      const h1 = unescape(
        sent.body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "",
      );
      const pre = unescape(
        sent.body.match(
          /<span style="display:none!important[^>]*>([\s\S]*?)<\/span>/,
        )
          ?.[1] ?? "",
      );
      const last = c.customer.split(" ")[1];
      expect(
        !h1.includes(last),
        `the email heading carries the customer tail: ${JSON.stringify(h1)}`,
      );
      expect.eq(
        h1,
        subjectJob,
        "the email heading is the subject's job, word for word",
      );
      expect(
        !pre.includes(last),
        `the preheader names the customer twice: ${JSON.stringify(pre)}`,
      );

      await page.goto(`${baseUrl}/q/${quote.id}?lang=${c.lang}`);
      const qTitle = page.locator("h1.ctr__title");
      await qTitle.waitFor({ timeout: 20_000 });
      const qHeading = (await qTitle.innerText()).trim();
      // Spanish /q embeds the job mid-sentence ("Acuerdo de pintura exterior
      // … para Lupe Garza"), where Spanish lowercases its first letter — the
      // same words, so compare case-blind (REQ-1087 note).
      expect(
        qHeading.toLocaleLowerCase(c.lang).includes(
          h1.toLocaleLowerCase(c.lang),
        ),
        `/q's heading ${
          JSON.stringify(qHeading)
        } names the same job as the email heading ${JSON.stringify(h1)}`,
      );
    }));
}
