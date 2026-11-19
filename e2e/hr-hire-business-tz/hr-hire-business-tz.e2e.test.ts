/**
 * REQ-1154 (LOOP-007 cycle 3, q3-86; AMENDMENT of REQ-944): "HR hire page prints times in UTC".
 * QA's browser ran in UTC; the business is in Austin (Central). /worker and /field/timesheet print
 * Central, but /hr/hires/<id> printed "Sent Nov 19 · 12:33 PM" — the device's UTC clock — because
 * front-end/lib/hr.ts fmtWhen formats with no timeZone. With the browser in UTC, the hire page's
 * "Sent …" line is the send instant on the business's wall clock.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const ZONE = "America/Chicago";

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      language: "en",
      name: "HR Zone Story",
      email: "hr-zone-story@example.com",
    }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      businessName: "Austin Tile & Bath",
      timezone: ZONE,
    }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

const norm = (s: string) => s.replace(/[\s  ]+/g, " ").trim();

/** "Nov 19 · 6:33 AM" — the instant on `zone`'s wall clock, the shape fmtWhen prints */
function wallClock(iso: string, zone: string): string {
  const d = new Date(iso);
  return norm(
    `${
      d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: zone,
      })
    } · ${
      d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: zone,
      })
    }`,
  );
}

Deno.test("REQ-1154 (LOOP-007 q3, q3-86): with the browser in UTC and the business in Central, /hr/hires/<id> prints 'Sent …' on the business's clock, not UTC", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const auth = await signIn(http, page, baseUrl);
    const me = await (await http("/api/me", { headers: auth })).json();
    expect.eq(me.businessTimezone, ZONE, "the business is in Central");

    // a real hire with a one-document packet, sent
    const doc = await (await http("/api/hr/documents", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Offer Letter",
        kind: "sign",
        contentHtml: "<p>Offer.</p>",
      }),
    })).json();
    const dept = await (await http("/api/hr/departments", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Field crew", division: "outbound" }),
    })).json();
    await (await http(`/api/hr/departments/${dept.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ docIds: [doc.id] }),
    })).body?.cancel();
    const hire = await (await http("/api/hr/hires", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        firstName: "Casey",
        email: "casey@blackhole.postmarkapp.com",
        departmentId: dept.id,
      }),
    })).json();
    if (!hire.id) throw new Error(`no hire: ${JSON.stringify(hire)}`);
    const sent = await (await http(`/api/hr/hires/${hire.id}/send`, {
      method: "POST",
      headers: auth,
      body: "{}",
    })).json();
    const sentAt: string | null = sent?.mail?.sentAt ?? null;
    expect(!!sentAt, `the hire is sent: ${JSON.stringify(sent?.mail)}`);

    const want = wallClock(sentAt!, ZONE);
    const utc = wallClock(sentAt!, "UTC");
    expect(want !== utc, `Central and UTC differ for ${sentAt}`);

    // QA's headless browser: the device clock is UTC
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTimezoneOverride", { timezoneId: "UTC" });

    await page.goto(`/hr/hires/${hire.id}?lang=en`);
    const mail = page.locator("[data-cy='hr-mail']");
    await mail.waitFor({ timeout: 30_000 });
    const seen = await page.evaluate(() => ({
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      sentLine:
        document.querySelector<HTMLElement>("[data-cy='hr-mail'] > span")
          ?.innerText ?? "",
    }));
    expect.eq(seen.zone, "UTC", "the browser runs in UTC, as QA's did");
    const line = norm(seen.sentLine);
    expect(
      !line.includes(utc),
      `the hire page prints the UTC clock: "${line}" (UTC "${utc}", business "${want}")`,
    );
    expect.eq(
      line,
      `Sent ${want}`,
      "the 'Sent …' line is the send instant on the business's (Central) clock",
    );
  }));
