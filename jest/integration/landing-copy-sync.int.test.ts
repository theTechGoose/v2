/**
 * REQ-742 — demo-loop cycle 5 (run r37f88707), demo issue p18-6e
 * "Landing title and hero differ". Real HTTP against the served "/": the
 * server-rendered <title> carries the very sentence the hero's <h1> reads.
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

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(
    /&quot;/g,
    '"',
  );

describe.each(["en", "es"] as const)(
  "REQ-742 p18-6e landing / (%s)",
  (lang) => {
    test("the <title> and og:title are 'DocuMonster — ' + the hero's sentence", async () => {
      const html = await landing(lang);
      const h1 = html.match(/data-i18n="hero\.h1Sr"[^>]*>([^<]*)</);
      expect(h1).not.toBeNull();
      const want = `DocuMonster — ${decode(h1![1])}`;
      const title = html.match(/<title>([^<]*)<\/title>/);
      expect(title).not.toBeNull();
      expect(decode(title![1])).toBe(want);
      const og = html.match(/property="og:title"\s+content="([^"]*)"/) ??
        html.match(/content="([^"]*)"\s+property="og:title"/);
      if (og) expect(decode(og[1])).toBe(want);
    });
  },
);

test("REQ-742 p18-6e es: the title says 'Nosotros manejamos el papeleo'", async () => {
  const html = await landing("es");
  expect(html).toMatch(
    /<title>DocuMonster — Tú haces el trabajo\. Nosotros manejamos el papeleo\.<\/title>/,
  );
});
