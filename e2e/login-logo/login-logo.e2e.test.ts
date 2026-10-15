/**
 * REQ-075 — Raphael, 2026-10-15: "okay deploy it to prod." The login card's monster logo
 * (front-end/routes/login.tsx, /logo-monster.png) was a broken image on prod and on every
 * routed preview: every PNG under front-end/static answered 404 because the repo's .gitignore
 * carried `*.png` and Deno Deploy packages the built tree by the repo's ignore rules. The
 * story pins what the visitor sees: the logo on the login card is a real, loaded image, and
 * the file itself answers as a PNG.
 */
import { story } from "#shots";

Deno.test("REQ-075: the login card shows the monster logo as a loaded image, and /logo-monster.png answers as a PNG", (t) =>
  story(t, async ({ page, expect, http }) => {
    await page.goto("/login");
    const logo = page.locator(".brand img").first();
    await logo.waitFor({ timeout: 15000 });
    const src = (await logo.getAttribute("src")) ?? "";
    expect(src.startsWith("/logo-monster.png"), `the card's logo is the monster PNG (Fresh adds its cache key) — ${src}`);
    const loaded = await logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
    expect(loaded, "the logo image loaded — a 404 leaves naturalWidth at 0");
    const res = await http("/logo-monster.png");
    expect.eq(res.status, 200, "/logo-monster.png answers 200");
    expect((res.headers.get("content-type") ?? "").startsWith("image/png"), `it is served as a PNG — ${res.headers.get("content-type")}`);
    await res.body?.cancel();
    await expect.see("DocuMonster");
  }));
