/**
 * REQ-353 — demo-loop cycle 1, demo issues M40 and m23: on a 390 px phone the
 * app never scrolls sideways and the headers fit.
 *
 * M40: after tapping "Just give me a quick quote." /assistant's <main> had
 * scrollLeft 17 (the whole app shifted left), and /invoices and /customers
 * showed a beige strip on the right. m23: the /assistant topbar pushed the
 * EN/ES pill past the right edge ("ES" cut off) and the worker screen's EN/ES
 * pill sat on top of "Mis tareas" with "Salir" touching the edge.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const W = 390;
const H = 844;
const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function owner(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
): Promise<Record<string, string>> {
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  await answerQuestions(http, auth, {
    name: "Maximiliano Fernández-Castellanos",
    businessName: "Fernández-Castellanos Landscaping & Hardscaping",
  });
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: lang }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]),
  );
  return auth;
}

interface Fit {
  docWidth: number;
  scrollX: number;
  mainScrollLeft: number;
  mainOverflow: number;
  /** <main>'s scrollLeft after a script tries to scroll it 999 px sideways */
  mainForced: number;
  /** elements whose box pokes past the viewport's right edge */
  wide: string[];
  /** topbar items that sit on top of each other */
  overlaps: string[];
  /** the EN/ES pill's right edge (must be ≤ 390) */
  langRight: number;
}

/** Measures the page at its current state: the document, <main>, and the topbar. */
function measure(page: StoryTools["page"], bar: string): Promise<Fit> {
  return page.evaluate(([bar, w]) => {
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${
        typeof el.className === "string" && el.className
          ? "." + el.className.trim().split(/\s+/).join(".")
          : ""
      }`;
    const main = document.querySelector("main, .main") as HTMLElement | null;
    const wide: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.position === "fixed") continue;
      if (r.right > (w as number) + 0.5) {
        // a deliberate sideways scroller (overflow-x auto/scroll, e.g. the
        // customer filter chips) may hold wider content; a hidden/clip
        // ancestor does NOT excuse it — that is content cut off
        let scroller = false;
        for (
          let a = el.parentElement;
          a && a !== document.body;
          a = a.parentElement
        ) {
          const ox = getComputedStyle(a).overflowX;
          if (ox === "auto" || ox === "scroll") {
            scroller = a.getBoundingClientRect().right <= (w as number) + 0.5;
            break;
          }
        }
        if (scroller) continue;
        // only the outermost offender, not every descendant
        const p = el.parentElement?.getBoundingClientRect();
        if (!p || p.right <= (w as number) + 0.5) {
          wide.push(`${name(el)} right=${Math.round(r.right)}`);
        }
      }
    }
    const top = document.querySelector(bar as string);
    const items = top
      ? [...top.children].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && c.tagName !== "STYLE";
      })
      : [];
    const overlaps: string[] = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i].getBoundingClientRect();
        const b = items[j].getBoundingClientRect();
        if (
          a.left < b.right - 0.5 && b.left < a.right - 0.5 &&
          a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
        ) {
          overlaps.push(`${name(items[i])} × ${name(items[j])}`);
        }
      }
    }
    const lang = document.querySelector(".topbar__lang, .top .lang");
    return {
      docWidth: document.documentElement.scrollWidth,
      scrollX: globalThis.scrollX,
      mainScrollLeft: main?.scrollLeft ?? 0,
      mainOverflow: main ? main.scrollWidth - main.clientWidth : 0,
      mainForced: (() => {
        // M40: whatever asks <main> to scroll sideways (a focus(), a
        // scrollIntoView) must not be able to move the app
        if (!main) return 0;
        const was = main.scrollLeft;
        main.scrollLeft = 999;
        const now = main.scrollLeft;
        main.scrollLeft = was;
        return now;
      })(),
      wide: wide.slice(0, 8),
      overlaps,
      langRight: lang ? Math.round(lang.getBoundingClientRect().right) : -1,
    };
  }, [bar, W] as const);
}

function assertFits(
  expect: StoryTools["expect"],
  f: Fit,
  where: string,
) {
  expect.eq(
    f.docWidth,
    W,
    `${where}: the page is ${W} px wide, no sideways scroll (wider: ${
      f.wide.join(", ")
    })`,
  );
  expect.eq(f.scrollX, 0, `${where}: the window is not scrolled sideways`);
  expect.eq(f.mainScrollLeft, 0, `${where}: <main> is not scrolled sideways`);
  expect.eq(
    f.mainForced,
    0,
    `${where}: <main> cannot be scrolled sideways at all (its hidden sideways range was ${f.mainOverflow} px)`,
  );
  expect.eq(
    f.wide.length,
    0,
    `${where}: nothing pokes past the right edge (${f.wide.join(", ")})`,
  );
  expect(
    f.langRight > 0 && f.langRight <= W,
    `${where}: the EN/ES pill is fully on screen (right=${f.langRight})`,
  );
  expect.eq(
    f.overlaps.length,
    0,
    `${where}: header items do not overlap (${f.overlaps.join("; ")})`,
  );
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-353 M40/m23 (${lang}): at 390 px /assistant, /invoices and /customers never scroll sideways and the topbar fits`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await page.setViewportSize({ width: W, height: H });
      await owner(http, page, baseUrl, lang);
      for (const route of ["/assistant", "/invoices", "/customers"]) {
        await page.goto(route);
        await page.locator(".topbar__lang").waitFor({ state: "visible" });
        await page.waitForLoadState("load");
        assertFits(expect, await measure(page, ".topbar"), `${lang} ${route}`);
      }
      // M40: the quick-quote starter focuses the composer — the app must not shift
      await page.goto("/assistant");
      const chip = page.getByText(
        lang === "es"
          ? "Solo dame una cotización rápida."
          : "Just give me a quick quote.",
      ).first();
      await chip.waitFor({ state: "visible", timeout: 15_000 });
      await chip.click();
      await page.waitForTimeout(400);
      assertFits(
        expect,
        await measure(page, ".topbar"),
        `${lang} /assistant after the quick-quote starter`,
      );
    }));
}

Deno.test("REQ-353 m23: at 390 px the Spanish worker header fits — Mis tareas, EN/ES, Volver a la oficina and Salir never overlap", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: W, height: H });
    const auth = await owner(http, page, baseUrl, "es");
    const cell = `843${digits()}`;
    const w = await http("/api/field/workers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Luis",
        phoneNumber: cell,
        pin: "1234",
        language: "es",
      }),
    });
    expect(
      w.status === 201 || w.status === 200,
      `worker created (${w.status})`,
    );
    await w.body?.cancel();
    await page.goto("/worker?lang=es");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    await page.locator("[data-cy='w-logout']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='w-office']").waitFor({ timeout: 15_000 });
    await expect.see("Mis tareas");
    await expect.see("Volver a la oficina");
    await expect.see("Salir");
    const f = await measure(page, ".top");
    assertFits(expect, f, "es /worker");
    const brand = await page.locator(".top .brand").evaluate((el) => ({
      clipped: el.scrollWidth > el.clientWidth + 0.5,
      text: (el.textContent ?? "").trim(),
    }));
    expect.eq(brand.text, "Mis tareas", "the worker title");
    expect(!brand.clipped, "the worker title 'Mis tareas' is not cut off");
  }));
