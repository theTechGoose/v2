/**
 * REQ-1161 — LOOP-007 cycle 3, QA issue q3-93 [polish/BUG_CONTRADICTION]: "Worker clock table day
 * label lowercase/reordered". A worker clocks in on /worker and opens the Reloj tab: the shift
 * table's Day cell read "jue 19" (es) / "19 Thu" (en), while the day tab above it reads
 * "Jue 19 de nov" / "Thu, Nov 19" (REQ-1065). Same day, same screen — same text.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const norm = (s: string) => s.replace(/[\s  ]+/g, " ").trim();

async function ownerWithWorker(http: StoryTools["http"], lang: "en" | "es") {
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
  if (!cookie) throw new Error(`sign-in: no session (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: lang, name: "Clock Day Story" }),
  });
  await me.body?.cancel();
  const cell = `843${digits()}`;
  const w = await http("/api/field/workers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: "Luis", phoneNumber: cell, pin: "1234", language: lang }),
  });
  if (w.status >= 300) throw new Error(`worker not created (${w.status} ${await w.text()})`);
  await w.body?.cancel();
  return cell;
}

for (const lang of ["es", "en"] as const) {
  Deno.test(`REQ-1161 (LOOP-007 q3-93): in ${lang}, the clock table's Day cell reads like the day tab (REQ-1065 label)`, (t) =>
    story(t, async ({ page, expect, http }) => {
      const cell = await ownerWithWorker(http, lang);

      await page.goto(`/worker?lang=${lang}`);
      await page.locator("[data-cy='w-cell']").fill(cell);
      await page.locator("[data-cy='w-pin']").fill("1234");
      await page.locator("[data-cy='w-login']").click();
      await page.locator("[data-cy='w-tab-clock']").waitFor({ timeout: 15_000 });
      await page.locator("[data-cy='w-day-today'] small").waitFor({ timeout: 15_000 });
      await page.locator("[data-cy='w-tab-clock']").click();
      await page.waitForFunction(
        () =>
          document.querySelector("[data-cy='clock-button']")?.getAttribute("data-state") === "out",
        undefined,
        { timeout: 15_000 },
      );
      const [res] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.request().method() === "POST" &&
            /\/timeclock\/worker\/punch$/.test(new URL(r.url()).pathname),
          { timeout: 15_000 },
        ),
        page.locator("[data-cy='clock-button']").click(),
      ]);
      expect.eq(res.status(), 201, "the punch is recorded");
      await res.body().catch(() => undefined);
      await page.locator("[data-cy='clock-shift'] td").first().waitFor({ timeout: 15_000 });

      // one read, so a re-render cannot land between the two
      const got = await page.evaluate(() => {
        const txt = (sel: string) => (document.querySelector(sel)?.textContent ?? "").trim();
        return {
          tab: txt("[data-cy='w-day-today'] small"),
          day: txt("[data-cy='clock-shift'] td"),
        };
      });
      const tab = norm(got.tab);
      const day = norm(got.day);
      if (lang === "es") {
        expect(/^[A-ZÁÉÍÓÚÑ]/.test(day), `the clock table's day starts with a capital (got "${day}")`);
        expect(/ de [a-z]/.test(day), `the clock table's day names the month like the tab (got "${day}", tab "${tab}")`);
      } else {
        expect(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/.test(day), `the clock table's day reads "Thu, Nov 19" style (got "${day}")`);
      }
      expect.eq(day, tab, "the clock table's Day cell reads like the day tab");
    }));
}
