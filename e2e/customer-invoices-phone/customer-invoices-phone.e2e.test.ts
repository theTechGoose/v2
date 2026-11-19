/**
 * REQ-1020 (LOOP-007 cycle 2, issue q2-11) — at 390x844 the customer page's
 * invoice tables (the Invoices tab and the Resumen "unpaid" table) keep every
 * cell — the balance (SALDO) and the row's Remind / Mark paid buttons — on
 * screen, or inside a local horizontal scroller the owner can pan. REQ-353
 * clips `.main` sideways, so a table wider than its card is cut off with no
 * way to reach its right side. Mark paid at 390px opens the payment sheet.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

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
    body: JSON.stringify({ language: "es", name: "Phone Table Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "es", domain, path: "/" },
  ]));
  return auth;
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  url: string,
  body: unknown,
) {
  const r = await http(url, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

/**
 * One read of the table: for each named part of the invoice row, its right
 * edge and whether the owner can reach it — on screen (right ≤ viewport), or
 * inside an ancestor that scrolls sideways (overflow-x auto|scroll) whose own
 * box is on screen.
 */
function reach(table: string, row: string) {
  const vw = window.innerWidth;
  const tbl = document.querySelector(table) as HTMLElement | null;
  const tr = document.querySelector(`${table} ${row}`) as HTMLElement | null;
  if (!tbl || !tr) {
    return {
      vw,
      missing: true,
      parts: [] as { name: string; right: number; ok: boolean }[],
    };
  }
  const scroller = (el: Element) => {
    for (
      let p = el.parentElement;
      p && p !== document.body;
      p = p.parentElement
    ) {
      const ox = getComputedStyle(p).overflowX;
      if (
        (ox === "auto" || ox === "scroll") &&
        p.getBoundingClientRect().right <= vw + 0.5
      ) return p;
    }
    return null;
  };
  const parts: { name: string; el: Element | null }[] = [
    ...[...tr.querySelectorAll(":scope > td")].map((td, i) => ({
      name: `td${i + 1}`,
      el: td as Element,
    })),
    { name: "balance", el: tr.querySelector("td.num:last-of-type, td.num b") },
    {
      name: "remind",
      el: tr.querySelector(
        ".cws-rowact .cws-btn:not([data-cy='cws-mark-paid'])",
      ),
    },
    { name: "mark-paid", el: tr.querySelector("[data-cy='cws-mark-paid']") },
  ];
  return {
    vw,
    missing: false,
    pageScrollW: document.documentElement.scrollWidth,
    tableRight: Math.round(tbl.getBoundingClientRect().right),
    parts: parts.map(({ name, el }) => {
      if (!el) return { name, right: -1, ok: false };
      const r = (el as HTMLElement).getBoundingClientRect();
      const visible = getComputedStyle(el).display !== "none" && r.width > 0;
      return {
        name,
        right: Math.round(r.right),
        ok: !visible
          ? name.startsWith("td")
          : r.right <= vw + 0.5 || !!scroller(el),
      };
    }),
  };
}

Deno.test("REQ-1020 (q2-11): at 390x844 the customer's Invoices tab and Resumen unpaid table keep the balance and Remind / Mark paid reachable, and Mark paid opens the payment sheet", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const auth = await signIn(http, page, baseUrl);
    const ana = await post(http, auth, "/api/customers", {
      name: `Ana Teléfono ${digits()}`,
      language: "es",
    });
    const inv = await post(http, auth, "/api/invoices", {
      customerId: ana.id,
      jobName: "Reparación de techo",
      amount: 98000,
      status: "sent",
      issuedDate: inDays(-20),
      dueDate: inDays(10),
    });
    await post(http, auth, "/api/payments", {
      invoiceId: inv.id,
      amount: 35000,
      method: "zelle",
      receivedAt: new Date().toISOString(),
    });

    const row = `[data-cy='cws-invoice-row'][data-id='${inv.id}']`;
    // every finding is collected, then asserted once, so one red run shows both tables and the click
    const got: Record<string, unknown> = {};
    const want: Record<string, unknown> = {};
    for (
      const [where, url, table] of [
        [
          "Invoices tab",
          `/customers/${ana.id}?tab=invoices`,
          "[data-cy='cws-invoices']",
        ],
        ["Resumen unpaid", `/customers/${ana.id}`, "[data-cy='cws-unpaid']"],
      ] as const
    ) {
      await page.goto(url);
      await page.locator(`${table} ${row} [data-cy='cws-mark-paid']`).waitFor({
        state: "attached",
        timeout: 20_000,
      });
      // one round trip: every edge is read in the same frame
      const facts = await page.evaluate(
        `(${reach.toString()})(${JSON.stringify(table)}, ${
          JSON.stringify(row)
        })`,
      ) as ReturnType<typeof reach>;
      expect(!facts.missing, `${where}: the part-paid invoice row is drawn`);
      got[`${where}: page scrollWidth ≤ ${facts.vw}`] =
        (facts.pageScrollW ?? 0) <= facts.vw;
      want[`${where}: page scrollWidth ≤ ${facts.vw}`] = true;
      got[`${where}: off-screen parts (table right edge ${facts.tableRight})`] =
        facts.parts.filter((p) => !p.ok).map((p) => `${p.name}@${p.right}`);
      want[
        `${where}: off-screen parts (table right edge ${facts.tableRight})`
      ] = [];
    }

    // Mark paid at 390px opens the payment sheet on that invoice (Resumen is the open page)
    const btn = page.locator(
      `[data-cy='cws-unpaid'] ${row} [data-cy='cws-mark-paid']`,
    );
    let sheetInvoice = "";
    try {
      await btn.click({ timeout: 8_000 });
      await page.locator(
        "[data-cy='cws-payment-sheet'] [data-cy='pay-received-form']",
      ).waitFor({ timeout: 15_000 });
      sheetInvoice = await page.locator(
        "[data-cy='cws-payment-sheet'] [data-cy='cws-payment-invoice']",
      ).inputValue();
    } catch (e) {
      sheetInvoice = `not opened: ${String(e).split("\n")[0]}`;
    }
    got["Mark paid at 390px opens the payment sheet on that invoice"] =
      sheetInvoice;
    want["Mark paid at 390px opens the payment sheet on that invoice"] = inv.id;

    expect.eq(
      JSON.stringify(got),
      JSON.stringify(want),
      "at 390x844 the invoice tables keep the balance and Remind / Mark paid reachable",
    );
  }));
