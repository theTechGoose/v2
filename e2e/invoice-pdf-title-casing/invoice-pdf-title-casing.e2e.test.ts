/**
 * REQ-1132 (LOOP-007 cycle 3, q3-64) — the invoice PDF is titled exactly as
 * the customer's /i page. A standalone invoice named "Gate repair, Hinge
 * hardware": /i (and the email) print it as typed, the PDF re-cased every
 * word to "Gate Repair, Hinge Hardware".
 */
import { story, type StoryTools } from "#shots";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "npm:pdf-lib@^1.17.1";

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
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "PDF Casing Story" }),
  });
  await me.body?.cancel();
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

/** Every content stream of the PDF, latin1 — case preserved. */
async function drawn(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        out += new TextDecoder("latin1").decode(
          decodePDFRawStream(obj).decode(),
        );
      } catch { /* not a text stream */ }
    }
  }
  return out;
}
/** pdf-lib draws standard-font text as `<HEX>`; case-sensitive match. */
const draws = (pdf: string, s: string) =>
  pdf.includes(
    `<${
      [...s].map((c) =>
        c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()
      ).join("")
    }>`,
  ) || pdf.includes(`(${s})`);

const JOB = "Gate repair, Hinge hardware";

Deno.test("REQ-1132 q3-64: a standalone invoice's PDF hero carries the /i title character for character — 'Gate repair, Hinge hardware', not 'Gate Repair, Hinge Hardware'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Gale Hinge",
        email: "gale@blackhole.postmarkapp.com",
      }),
    })).json();
    const created = await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: JOB,
        amount: 45000,
      }),
    });
    const inv = await created.json();
    expect(created.ok, `invoice created (${created.status})`);

    await page.goto(`/i/${inv.id}`);
    const h1 = page.locator("[data-cy='invoice-doc'] h1").first();
    await h1.waitFor({ timeout: 15_000 });
    const heading = (await h1.innerText()).trim();
    expect.eq(heading, JOB, "setup: /i is headed by the stored job name");

    const r = await http(`/api/invoices/${inv.id}/pdf`, { headers: auth });
    expect.eq(r.status, 200, "the PDF downloads");
    if (r.status !== 200) return;
    const pdf = await drawn(new Uint8Array(await r.arrayBuffer()));
    expect(
      !draws(pdf, "Gate Repair, Hinge Hardware"),
      "the PDF does not re-case the title to 'Gate Repair, Hinge Hardware'",
    );
    expect(
      draws(pdf, heading),
      `the PDF hero is the /i title '${heading}' exactly`,
    );
  }));
