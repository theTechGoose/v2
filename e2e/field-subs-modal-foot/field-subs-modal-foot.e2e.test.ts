/**
 * REQ-734 — demo-loop cycle 5, issue m69: at 1280x800 the "Nueva suscripción" modal's
 * Cancelar / Agregar buttons were cut off below the fold of the modal's scroller, and its
 * address placeholder was DocuMonster's own office ("4505 Socastee Blvd, Myrtle Beach, SC").
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
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
    body: JSON.stringify({ language: lang, name: "Field Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: lang,
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

for (const lang of ["es", "en"] as const) {
  Deno.test(`REQ-734 (demo-loop cycle 5, m69): ${lang} — the New subscription modal's buttons are in view at 1280x800, and the address example is neutral`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await signIn(http, page, baseUrl, lang);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/field/subscriptions");
      const open = page.locator("[data-cy='subs-new']").first();
      await open.waitFor({ timeout: 15_000 });
      await open.click();
      const form = page.locator("[data-cy='subs-form']");
      await form.waitFor({ timeout: 15_000 });
      const submit = page.locator("[data-cy='subs-submit']");
      const cancel = form.locator(".btn--cancel");
      const geo = await page.evaluate(() => {
        const f = document.querySelector("[data-cy='subs-form']")!;
        const s = document.querySelector("[data-cy='subs-submit']")!;
        const c = document.querySelector("[data-cy='subs-form'] .btn--cancel")!;
        const r = (e: Element) => {
          const b = e.getBoundingClientRect();
          return { top: Math.round(b.top), bottom: Math.round(b.bottom) };
        };
        return {
          vh: innerHeight,
          overflows: f.scrollHeight > f.clientHeight,
          form: r(f),
          submit: r(s),
          cancel: r(c),
        };
      });
      expect.eq(
        geo.overflows,
        true,
        `the form scrolls at 1280x800 (else the test proves nothing) — ${
          JSON.stringify(geo)
        }`,
      );
      for (const key of ["submit", "cancel"] as const) {
        const b = geo[key];
        expect.eq(
          b.bottom <= geo.form.bottom && b.top >= geo.form.top &&
            b.bottom <= geo.vh,
          true,
          `the ${key} button is inside the modal's visible box with the form scrolled to its top — ${
            JSON.stringify(geo)
          }`,
        );
      }
      // and it is the topmost element at its centre (not hidden under the form's own fields)
      for (const loc of [submit, cancel]) {
        const box = (await loc.boundingBox())!;
        const hit = await page.evaluate(
          ([x, y]) => {
            const e = document.elementFromPoint(x, y);
            return !!e?.closest("[data-cy='subs-form'] .modal__foot");
          },
          [box.x + box.width / 2, box.y + box.height / 2],
        );
        expect.eq(
          hit,
          true,
          "the footer button is what a click at its centre hits",
        );
      }
      // the strip under the buttons, down to the box's bottom edge, is the footer's own
      // ground — fields scrolled under the footer never show through the box's padding
      const strip = await page.evaluate(() => {
        const f = document.querySelector("[data-cy='subs-form']")!;
        f.scrollTop = Math.floor((f.scrollHeight - f.clientHeight) / 2);
        const b = f.getBoundingClientRect();
        const x = b.left + b.width / 2;
        return [b.bottom - 3, b.bottom - 12, b.bottom - 20].map((y) =>
          !!document.elementFromPoint(x, y)?.closest(".modal__foot")
        );
      });
      expect.eq(
        strip.every(Boolean),
        true,
        `the footer covers the box's bottom strip — ${JSON.stringify(strip)}`,
      );
      const ph = await page.locator("[data-cy='subs-address']").getAttribute(
        "placeholder",
      );
      expect.eq(
        /Socastee|Myrtle Beach/i.test(ph ?? ""),
        false,
        `the address example is not DocuMonster's own office — ${ph}`,
      );
    }));
}
