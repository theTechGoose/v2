/**
 * REQ-1125 — LOOP-007 cycle 3, QA issue q3-53 [BUG_POLISH]: on /invoices the
 * Overdue card's "OVERDUE" stage pill was white text (STAGE_MOOD.overdue
 * statusFg "#fff") on the white `.qcard__status` pill (rgba(255,255,255,0.92)),
 * so the label could not be read. Seed one past-due invoice, open /invoices and
 * measure the pill label's computed colour against its computed background,
 * composited over the card's mood gradient end, at WCAG AA (4.5:1).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

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
    body: JSON.stringify({ language: "en", name: "Overdue Pill" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: Record<string, unknown>,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

type RGBA = [number, number, number, number];
const parse = (s: string): RGBA => {
  const n = (s.match(/[\d.]+/g) ?? []).map(Number);
  return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
};
const over = (top: RGBA, under: RGBA): RGBA => {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1) as RGBA;
};
const lum = ([r, g, b]: RGBA) => {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
const ratio = (a: RGBA, b: RGBA) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

Deno.test("REQ-1125 (LOOP-007 q3-53): the /invoices Overdue card's 'OVERDUE' pill label reads at >= 4.5:1 on its white pill (not white on white)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { name: "Overdue Pill" });
    const ana = await post(http, auth, "/api/customers", { name: "Ana Torres" });
    await post(http, auth, "/api/invoices", {
      customerId: ana.id,
      status: "sent",
      jobName: "Gutter clean",
      amount: 100_000,
      issuedDate: daysFromNow(-20),
      dueDate: daysFromNow(-3),
    });

    await page.goto("/invoices");
    const pill = page.locator(".qcard--inv .qcard__status", { hasText: /overdue/i }).first();
    await pill.waitFor({ timeout: 20_000 });

    // one evaluate: label colour, pill background, and the card's mood ends
    const seen = await pill.evaluate((el) => {
      const cs = getComputedStyle(el);
      const card = el.closest(".qcard") as HTMLElement;
      const cardCs = getComputedStyle(card);
      return {
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
        color: cs.color,
        background: cs.backgroundColor,
        moodFrom: cardCs.getPropertyValue("--mood-from").trim(),
        moodTo: cardCs.getPropertyValue("--mood-to").trim(),
      };
    });
    console.log(JSON.stringify(seen));
    expect(/overdue/i.test(seen.text), `the pill says OVERDUE (${seen.text})`);

    const hex = (h: string): RGBA => {
      const x = h.replace("#", "");
      const f = x.length === 3 ? [...x].map((c) => c + c).join("") : x;
      return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)).concat(1) as RGBA;
    };
    const fg = parse(seen.color);
    const bg = parse(seen.background);
    for (const end of [seen.moodFrom, seen.moodTo]) {
      const under = /^#/.test(end) ? hex(end) : [255, 255, 255, 1] as RGBA;
      const pillBg = over(bg, under);
      const r = ratio(over(fg, pillBg), pillBg);
      expect(
        r >= 4.5,
        `OVERDUE label ${seen.color} on pill ${seen.background} over ${end} = ${r.toFixed(2)}:1, needs >= 4.5:1`,
      );
    }
  }));
