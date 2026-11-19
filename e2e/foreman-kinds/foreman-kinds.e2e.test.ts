/**
 * REQ-1008 (LOOP-007 q1, q1-94) — "Foreman" means two different powers. On the real
 * /field/workers page the add-worker checkbox (the account-wide role: sees and closes every
 * crew's visits) and the New crew modal's lead picker (that crew's visits only) must not carry
 * the same word, and on /worker the chip a crew lead sees must not be the account-wide one.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"]) {
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Foreman Story" }),
  })).body?.cancel();
  return { auth, cookie };
}

Deno.test("REQ-1008 (q1-94): the account-wide foreman and a crew lead carry different names on /field/workers and /worker", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, cookie } = await signIn(http);
    const post = async (p: string, b: unknown) => {
      const r = await http(p, { method: "POST", headers: auth, body: JSON.stringify(b) });
      const j = await r.json();
      if (r.status >= 300) throw new Error(`${p} → ${r.status} ${JSON.stringify(j)}`);
      return j;
    };
    const samCell = `843${digits()}`;
    const anaCell = `843${digits()}`;
    await post("/api/field/workers", { name: "Sam", phoneNumber: samCell, pin: "1234", role: "foreman", language: "en" });
    const ana = await post("/api/field/workers", { name: "Ana", phoneNumber: anaCell, pin: "1234", language: "en" });
    await post("/api/field/crews", { name: "Grass crew", memberIds: [ana.id], foremanId: ana.id });

    const hosts = [...new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"])];
    const [cn, cv] = cookie.split("=");
    const langCookies = hosts.map((domain) => ({ name: "pm_lang", value: "en", domain, path: "/" }));
    await page.context().addCookies([
      ...hosts.map((domain) => ({ name: cn, value: cv, domain, path: "/" })),
      ...langCookies,
    ]);

    // /field/workers: the add checkbox vs the New crew modal's lead picker
    await page.goto("/field/workers");
    await page.locator("[data-cy='wk-row']").first().waitFor({ timeout: 20_000 });
    const checkboxLabel = (await page.locator("label:has([data-cy='wk-foreman'])").innerText()).trim();
    await page.locator("[data-cy='crew-new']").click();
    const picker = page.locator("[data-cy='crew-form'] label:has(select[data-cy='crew-foreman'])");
    await picker.waitFor({ timeout: 15_000 });
    // the label's own words, without the options inside the select
    const pickerLabel = (await picker.evaluate((el) =>
      [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("")
    ))!.trim();
    expect(pickerLabel.length > 0, "the crew lead picker has a label");
    expect(
      !checkboxLabel.toLowerCase().includes(pickerLabel.toLowerCase()),
      `the account-wide checkbox ("${checkboxLabel}") must not use the crew lead's word ("${pickerLabel}")`,
    );

    // /worker: the chip each kind of foreman sees
    const chipOf = async (cell: string, name: string) => {
      await page.context().clearCookies();
      await page.context().addCookies(langCookies);
      await page.goto("/worker");
      await page.locator("[data-cy='w-cell']").fill(cell);
      await page.locator("[data-cy='w-pin']").fill("1234");
      await page.locator("[data-cy='w-login']").click();
      await page.getByText(`Hey, ${name}`).waitFor({ timeout: 15_000 });
      const chip = page.locator(".greet .chip--amber");
      return (await chip.count()) ? (await chip.first().innerText()).trim() : "";
    };
    const samChip = await chipOf(samCell, "Sam");
    const anaChip = await chipOf(anaCell, "Ana");
    expect(samChip.length > 0, "the account-wide foreman has a role chip");
    expect(anaChip.length > 0, "the crew lead has a role chip");
    expect(
      samChip !== anaChip,
      `a crew lead's chip ("${anaChip}") must not read the same as the account-wide one ("${samChip}")`,
    );
    expect(
      !samChip.toLowerCase().includes(pickerLabel.toLowerCase()),
      `the account-wide chip ("${samChip}") must not use the crew lead's word ("${pickerLabel}")`,
    );
  }));
