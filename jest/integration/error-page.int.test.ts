/**
 * REQ-294 — demo-loop cycle 1, issues m43 + m21: a mistyped URL lands on the branded 404 that
 * says DocuMonster (not the old brand, ee6f1a6f's literal) and sets a page font,
 * so the demo pill on it does not fall back to the browser's default face. Real HTTP against
 * the front-end (FRONTEND_BASE_URL, default :5280).
 */
const FE = process.env.FRONTEND_BASE_URL ?? "http://localhost:5280";

const text = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

describe("REQ-294 GET /nope — the 404 page", () => {
  let status = 0;
  let html = "";
  beforeAll(async () => {
    const res = await fetch(`${FE}/nope`, {
      headers: { cookie: "pm_lang=en" },
      redirect: "manual",
    });
    status = res.status;
    html = await res.text();
  });

  it("REQ-294 answers 404 with the brand DocuMonster, never the old brand (demo m43)", () => {
    expect(status).toBe(404);
    const t = text(html);
    expect(t).toMatch(/DocuMonster/);
    expect(t).not.toMatch(/paperwork\s*monster/i);
  });

  it("REQ-294 links a stylesheet that sets the body font (demo m21)", async () => {
    const href = html.match(
      /<link rel="stylesheet" href="([^"]*error-page\.css[^"]*)"/,
    )?.[1];
    expect(href).toBeDefined();
    const css = await (await fetch(`${FE}${href}`)).text();
    const body = css.match(/body\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(body).toMatch(/font-family:\s*"Inter"/);
  });
});
