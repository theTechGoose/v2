/**
 * REQ-412 — demo-loop cycle 2 (run r561db6d4), demo issues m41 + p12, real
 * HTTP against the served landing page "/".
 *
 * (m41) The hero's document card and phone bubble must add up: their rows sum
 *       to the total they print (the demo saw $4,200 + $3,990 + $1,950 under
 *       "$10,990.00").
 * (p12) The documents counter is server-rendered with its final number, so a
 *       snapshot / text extraction before any scroll never reads "0".
 */
const FE = process.env.FRONTEND_BASE_URL ?? "http://localhost:5280";

async function landing(lang: "en" | "es"): Promise<string> {
  const res = await fetch(`${FE}/?lang=${lang}`, {
    headers: { cookie: `pm_lang=${lang}` },
    redirect: "manual",
  });
  expect(res.status).toBe(200);
  return await res.text();
}

/** "$4,200.00" / "$ 4,200" → cents. */
const cents = (s: string) =>
  Math.round(Number(s.replace(/[^0-9.]/g, "")) * 100);
const amounts = (html: string) =>
  [...html.matchAll(/<strong>([^<]*\$[^<]*)<\/strong>/g)].map((m) =>
    cents(m[1])
  );

/** The markup between `open` and the next `close` marker. */
function block(html: string, open: string, close: string): string {
  const i = html.indexOf(open);
  expect(i).toBeGreaterThanOrEqual(0);
  const j = html.indexOf(close, i);
  expect(j).toBeGreaterThan(i);
  return html.slice(i, j);
}

describe.each(["en", "es"] as const)("REQ-412 landing / (%s)", (lang) => {
  test("m41: the hero document card's rows sum to its total, demolition included", async () => {
    const html = await landing(lang);
    const card = block(html, 'class="hs-doc__rows"', 'class="hs-doc__sign"');
    const all = amounts(card);
    const total = all.pop()!;
    expect(all.length).toBe(4);
    expect(all.reduce((a, b) => a + b, 0)).toBe(total);
    expect(card).toContain('data-i18n="doc.q.l0"');
  });

  test("m41: the hero phone bubble's rows sum to its total", async () => {
    const html = await landing(lang);
    const rich = block(html, "hs-bubble--rich", 'class="hs-rich__cta"');
    const all = amounts(rich);
    const total = all.pop()!;
    expect(all.length).toBe(3);
    expect(all.reduce((a, b) => a + b, 0)).toBe(total);
  });

  test("m41: the boot the static script reads carries the same subtotal", async () => {
    const html = await landing(lang);
    const m = html.match(/window\.__PM_MOCK_QUOTE=(\{.*?\});/);
    expect(m).not.toBeNull();
    const boot = JSON.parse(m![1]);
    const rows = Object.values(boot.lines as Record<string, { amount: string }>)
      .map((l) => cents(l.amount));
    expect(rows.reduce((a, b) => a + b, 0)).toBe(cents(boot.subtotal));
  });

  test("p12: the documents counter is server-rendered with the real, grouped number", async () => {
    const html = await landing(lang);
    const m = html.match(/id="doc-counter-num"[^>]*>([^<]*)</);
    expect(m).not.toBeNull();
    // REQ-499 (demo p6): US-grouped in Spanish too, like the page's money.
    expect(m![1]).toBe("48,217");
  });
});

describe("REQ-499 (demo p6, cycle 3) landing counts are US-grouped in Spanish, like its money", () => {
  test("es: '+1,200 contratistas' and the counter boot carry no '1.200'", async () => {
    const html = await landing("es");
    expect(html).toMatch(/\+1,200 contratistas/);
    expect(html).not.toMatch(/\+1\.200|48\.217/);
    const m = html.match(/window\.__PM_OFFER=(\{.*?\});/);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1]).counts.contractors.es).toBe("1,200");
  });
});
