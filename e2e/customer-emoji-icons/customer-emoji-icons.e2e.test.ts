/**
 * REQ-1147 (LOOP-007 cycle 3, q3-78) — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the test, then one to fix it and
 * make it green." QA: "Emoji in menus and the activity feed". The customer page's More menu drew
 * 💬 / 🔁 next to the SVG pencil of "Edit"; the header drew 📍 next to the SVG phone; the service
 * card's subline drew 📍 next to its SVG repeat icon; the activity feed's dots were 💵 🧾 📝 🔁; the
 * customers sidebar line was "🔁 <schedule>". Emoji draw through the OS colour-emoji font, so one
 * menu / row mixes two icon styles. Every one of these is an inline SVG (lib/dash-icons.tsx ICN.*).
 * This asserts the rendered markup, not pixels (fonts vary per machine).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const PICTO = "\\p{Extended_Pictographic}";

async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
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
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Emoji Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return auth;
}

Deno.test("REQ-1147 (q3-78): the customer page's More menu, header address, activity feed, service card and sidebar line draw SVG icons, never emoji", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const call = async (method: string, url: string, body?: unknown) => {
      const r = await http(url, { method, headers: auth, ...(body ? { body: JSON.stringify(body) } : {}) });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(json)}`);
      return json;
    };
    const today = new Date().toISOString().slice(0, 10);
    const ana = await call("POST", "/api/customers", {
      name: `Ana Emoji ${digits()}`,
      phoneNumber: "(305) 555-0142",
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
    });
    // a recurring service: the service card, and her sidebar line is the "rec" schedule line
    const sub = await call("POST", "/api/field/subscriptions", {
      customerId: ana.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: today,
      items: [{ taskTypeName: "Gutter cleaning", priceCents: 6500 }],
    });
    // today's visit done: an activity-feed item ("Gutter cleaning visit done")
    const worker = await call("POST", "/api/field/workers", { name: "Luis Herrera", phoneNumber: `843${digits()}`, pin: "1234" });
    await call("PUT", `/api/field/regions/${sub.region.id}/worker`, { workerId: worker.id });
    const tasks = await call("GET", `/api/field/tasks?date=${today}`);
    if (!tasks.length) throw new Error("no visit today for the new service");
    await call("PUT", `/api/field/tasks/${tasks[0].id}`, { status: "complete" });

    await page.goto(`/customers/${ana.id}`);
    const ws = page.locator(`[data-cy='customer-workspace'][data-customer='${ana.id}']`);
    await ws.waitFor({ timeout: 20_000 });

    // (1) the header's contact line: phone, address — all SVG, no emoji
    const contact = await ws.locator(".cws-contact").evaluate((el, picto) => ({
      text: el.textContent ?? "",
      emoji: (el.textContent ?? "").match(new RegExp(picto, "gu")) ?? [],
      items: [...el.children].map((c) => ({ text: c.textContent ?? "", svg: c.querySelectorAll("svg").length })),
    }), PICTO);
    expect.eq(contact.emoji, [], `no emoji in the header contact line (${JSON.stringify(contact.text)})`);
    const addr = contact.items.find((i) => i.text.includes("Dick Pond"));
    expect(!!addr, `the address is in the header (${JSON.stringify(contact.items)})`);
    expect.eq(addr?.svg ?? 0, 1, `the address draws an SVG pin like phone / mail (${JSON.stringify(addr)})`);

    // (2) the More menu: every item with an icon draws it as SVG; no emoji anywhere
    await ws.locator("[data-cy='cws-more']").click();
    const menu = ws.locator("[data-cy='cws-menu']");
    await menu.waitFor({ timeout: 10_000 });
    const m = await menu.evaluate((el, picto) => ({
      text: el.textContent ?? "",
      emoji: (el.textContent ?? "").match(new RegExp(picto, "gu")) ?? [],
      items: [...el.querySelectorAll("[role=menuitem]")].map((i) => ({
        cy: i.getAttribute("data-cy"),
        text: (i.textContent ?? "").trim(),
        svg: i.querySelectorAll("svg").length,
      })),
    }), PICTO);
    expect.eq(m.emoji, [], `no emoji in the More menu (${JSON.stringify(m.text)})`);
    for (const it of m.items.filter((i) => /Send a text|recurring service|Edit/i.test(i.text))) {
      expect.eq(it.svg, 1, `"${it.text}" draws one SVG icon like Edit's pencil`);
    }
    await page.keyboard.press("Escape");

    // (3) the activity feed: every .cws-dot holds an <svg>, no emoji
    const feed = ws.locator("[data-cy='cws-activity']");
    await feed.waitFor({ timeout: 15_000 });
    const f = await feed.evaluate((el, picto) => ({
      text: el.textContent ?? "",
      emoji: (el.textContent ?? "").match(new RegExp(picto, "gu")) ?? [],
      dots: [...el.querySelectorAll(".cws-dot")].map((d) => ({ html: d.innerHTML, svg: d.querySelectorAll("svg").length })),
    }), PICTO);
    expect(f.dots.length > 0, "the feed has items");
    expect.eq(f.emoji, [], `no emoji in the activity feed (${JSON.stringify(f.text)})`);
    for (const d of f.dots) expect.eq(d.svg, 1, `the activity dot is an SVG (${d.html})`);

    // (4) the service card's subline: SVG pin, no emoji
    await page.goto(`/customers/${ana.id}?tab=recurring`);
    const card = page.locator(`[data-cy='cws-service'][data-id='${sub.id}']`);
    await card.waitFor({ timeout: 20_000 });
    const s = await card.locator(".cws-svc__sub").evaluate((el, picto) => ({
      text: el.textContent ?? "",
      emoji: (el.textContent ?? "").match(new RegExp(picto, "gu")) ?? [],
      svg: el.querySelectorAll("svg").length,
    }), PICTO);
    expect.eq(s.emoji, [], `no emoji in the service subline (${JSON.stringify(s.text)})`);
    expect(s.svg >= 1, `the service subline's address draws an SVG pin (${JSON.stringify(s.text)})`);

    // (5) her sidebar row's schedule line: no emoji
    const line = page.locator(`[data-cy='nav-customer-row'][data-id='${ana.id}'] [data-cy='nav-customer-line']`);
    await line.waitFor({ timeout: 20_000 });
    const navText = (await line.textContent()) ?? "";
    expect.eq(navText.match(new RegExp(PICTO, "gu")) ?? [], [], `no emoji in her sidebar line (${JSON.stringify(navText)})`);
  }));
