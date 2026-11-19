/**
 * REQ-965 — LOOP-007 cycle 1, issue q1-42 ("PDFs print phone numbers
 * unformatted"), on the real app: the customer's public invoice page /i/:id
 * shows the contractor's phone as "(512) 555-NNNN"; the PDF its Download link
 * serves prints that same string, and BILL TO prints the customer typed as
 * "843-555-0142" as "(843) 555-0142" — never the stored E.164 or as-typed.
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
  if (!cookie) throw new Error(`sign-in: no session (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Marcus Reyes" }),
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
  return { auth, phone };
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Every string the PDF draws (pdf-lib writes `<hex> Tj` in Flate streams). */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const raw = new TextDecoder("latin1").decode(bytes);
  let text = "";
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    // the EOL before `endstream` is not part of the data (a trailing byte makes
    // inflate throw), but the data itself may end in 0x0A — try each cut
    let s: string | undefined;
    for (const cut of [end - 1, end - 2, end]) {
      try {
        s = new TextDecoder("latin1").decode(
          await inflate(bytes.slice(start, cut)),
        );
        break;
      } catch { /* the next cut, or an image / font stream */ }
    }
    if (s === undefined) continue;
    for (const t of s.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      let line = "";
      for (let i = 0; i + 1 < t[1].length; i += 2) {
        line += String.fromCharCode(parseInt(t[1].slice(i, i + 2), 16));
      }
      text += line + "\n";
    }
  }
  return text;
}

Deno.test("REQ-965 (q1-42): the invoice PDF downloaded from /i/:id prints the contractor's phone as the page shows it and the customer's '843-555-0142' as '(843) 555-0142'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, phone } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Dana Pruitt",
        email: "dana.pruitt@blackhole.postmarkapp.com",
        phoneNumber: "843-555-0142",
      }),
    })).json();
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Roof repair",
        lineItems: [{ description: "Roof repair", quantity: 1, unit: "job", price: 50000 }],
        amount: 50000,
      }),
    })).json();

    await page.goto(`/i/${inv.id}`);
    const tel = page.locator(`a[href='tel:${phone}']`).last();
    await tel.waitFor({ timeout: 15_000 });
    const shown = (await tel.textContent() ?? "").trim();
    const d = phone.slice(2);
    const pretty = `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    expect.eq(shown, pretty, "the public invoice page shows the contractor phone formatted");

    const href = await page.locator(`a[href$='/pdf']`).first().getAttribute("href");
    expect.eq(href, `/api/invoices/${inv.id}/pdf`, "the page's Download PDF link");
    const r = await http(href ?? "");
    expect.eq(r.status, 200, "the PDF downloads");
    const text = await pdfText(new Uint8Array(await r.arrayBuffer()));
    expect(text.includes("Dana Pruitt"), `the PDF text was extracted:\n${text.slice(0, 400)}`);
    expect(text.includes(pretty), `the PDF's FROM prints '${pretty}' like the page (got:\n${text.slice(0, 600)})`);
    expect(!text.includes(phone), `the PDF does not print the raw '${phone}'`);
    expect(text.includes("(843) 555-0142"), "BILL TO prints the customer phone '(843) 555-0142'");
    expect(!text.includes("843-555-0142"), "BILL TO does not print the as-typed '843-555-0142'");
  }));
