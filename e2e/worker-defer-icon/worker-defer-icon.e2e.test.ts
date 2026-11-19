/**
 * REQ-1070 — LOOP-007 cycle 2, QA issue q2-59: the worker's Defer buttons drew a
 * literal "⏭" (U+23ED, Misc Technical) where their row-mates (Note, Services) draw
 * an inline SVG. REQ-366: every UI icon on an app surface is an SVG from
 * components/ui/Icon.tsx. Whether the glyph shows as tofu depends on the
 * browser's fonts, so this story checks the markup: each Defer control carries
 * an <svg> and its text has no U+2300–U+23FF character.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

async function owner(http: StoryTools["http"]) {
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
  return { ...JSON_HEADERS, cookie };
}

Deno.test("REQ-1070 (LOOP-007 q2-59): the worker's Defer visit / Defer buttons draw an SVG icon, never a literal ⏭ glyph", (t) =>
  story(t, async ({ page, expect, http }) => {
    const auth = await owner(http);
    const post = async (p: string, b: unknown) => {
      const r = await http(p, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(b),
      });
      return r.json();
    };
    const customer = await post("/api/customers", {
      name: "Rosa Vega",
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
    });
    const cell = `843${digits()}`;
    const worker = await post("/api/field/workers", {
      name: "Miguel",
      phoneNumber: cell,
      pin: "1234",
      language: "en",
    });
    const made = await post("/api/field/tasks", {
      customerId: customer.id,
      date: todayIso(),
      taskTypeName: "Leaf cleanup",
      priceCents: 500,
      workerId: worker.id,
    });
    if (!made?.id) throw new Error(`one-off: ${JSON.stringify(made)}`);

    await page.goto("/worker");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    await page.locator("[data-cy='w-defer-visit']").first().waitFor({
      timeout: 15_000,
    });
    // open the services panel so the per-task Defer button is drawn too
    await page.locator("[data-cy='w-services-btn']").first().click();
    await page.locator("[data-cy='w-defer']").first().waitFor({
      timeout: 15_000,
    });

    const probe = await page.evaluate(() =>
      ["w-defer-visit", "w-defer", "w-note-btn"].map((cy) => {
        const el = document.querySelector(`[data-cy='${cy}']`);
        const text = el?.textContent ?? "";
        return {
          cy,
          svg: !!el?.querySelector("svg"),
          text,
          misc: [...text].filter((c) => /[⌀-⏿]/u.test(c)).map((c) =>
            `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`
          ),
        };
      })
    );
    const faults: string[] = [];
    for (const b of probe) {
      if (!b.svg) faults.push(`${b.cy} has no <svg> icon (text "${b.text}")`);
      if (b.misc.length) {
        faults.push(
          `${b.cy} text carries a Misc Technical glyph ${
            b.misc.join(",")
          } ("${b.text}")`,
        );
      }
    }
    expect(faults.length === 0, faults.join(" | "));
  }));
