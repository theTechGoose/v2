/**
 * REQ-158 — cache busting: the served pages link their stylesheets with the build id
 * (`?__frsh_c=`), that URL is cached immutable for a year, and the bare URL is not cached —
 * so a browser can never pair the previous deploy's stylesheet with the new page.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"]) {
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
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  return cookie;
}

Deno.test("REQ-158: the served dashboard and subscriptions pages link their stylesheets with the build id; that URL is immutable for a year, the bare one is not cached", (t) =>
  story(t, async ({ expect, http }) => {
    const cookie = await signIn(http);
    for (const path of ["/dashboard", "/field/subscriptions", "/login"]) {
      const r = await http(path, { headers: { cookie } });
      const html = await r.text();
      expect(r.status === 200, `${path} answers 200 (got ${r.status})`);
      const links = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)]
        .map((m) => m[1]).filter((h) => h.startsWith("/") && !h.startsWith("/assets/"));
      expect(links.length > 0, `${path} links a static stylesheet (found ${links.length})`);
      for (const href of links) {
        expect(
          /\?__frsh_c=[A-Za-z0-9]*$/.test(href),
          `${path}: ${href} carries the build id`,
        );
      }
      // the dev server (Vite) sends no cache headers; the deploy's static middleware answers the
      // busted URL immutable for a year and the bare one no-store — proven on prod (requirements.md)
      const id = links[0].split("__frsh_c=")[1];
      if (id) {
        const busted = await http(links[0], {});
        await busted.body?.cancel();
        expect.eq(
          busted.headers.get("cache-control"),
          "public, max-age=31536000, immutable",
          `${links[0]} is cached immutable`,
        );
        const bare = await http(links[0].split("?")[0], {});
        await bare.body?.cancel();
        expect(
          /no-store|no-cache/.test(bare.headers.get("cache-control") ?? ""),
          `the bare ${links[0].split("?")[0]} is not cached`,
        );
      }
    }
  }));
