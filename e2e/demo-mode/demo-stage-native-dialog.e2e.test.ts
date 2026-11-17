/**
 * Demo-loop run 16 (by hand) — three stage-side polish items.
 *  m3 — REQ-827 AMENDMENT: a native confirm() on the customer's screen (a draft's "Eliminar")
 *       blocked her page while the stage said "Live" with no sign of it. The customer's overlay
 *       wraps confirm()/alert() while the demo is on: the words go out on the link before the
 *       question blocks the thread, and the stage says them in its chrome row
 *       ([data-cy=demo-native-dialog]) until the dialog is answered.
 *  p3 — REQ-868 AMENDMENT: under "The demo ended" the stage kept drawing the customer's folded
 *       pill ("Demo ×") for the ~1.2 s before the hop to /admin. An ended stage drops the folded
 *       tab's ghost too; her whole ended notice is still drawn (REQ-895).
 *  p2 — REQ-864 AMENDMENT: /admin's grant button read "…" while Demo said "Opening…" (one busy
 *       id for three actions). Only Demo shows the pending state.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function verify(http: StoryTools["http"], phone: string) {
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
  if (!cookie) throw new Error("sign-in: no session cookie");
  return { body, cookie, auth: { ...JSON_HEADERS, cookie } };
}
// deno-lint-ignore no-explicit-any
async function useCookie(ctx: any, baseUrl: string, cookie: string) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await ctx.clearCookies();
  await ctx.addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
}

/** the user's row on /admin: every button's words */
const rowButtons = () => {
  const demo = document.querySelector("[data-cy='adm-demo']");
  const row = demo?.closest("tr");
  return Array.from(row?.querySelectorAll("button") ?? []).map((b) =>
    (b.textContent ?? "").trim()
  );
};

Deno.test("REQ-864 AMENDMENT (p2) + REQ-827 AMENDMENT (m3) + REQ-868 AMENDMENT (p3) — demo-loop run 16: Demo's pending state is Demo's alone; a native confirm() on her screen is said in the stage's chrome row until answered; an ended stage draws no pill ghost", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Maria Lopez" }),
    })).body?.cancel();
    await answerQuestions(http, user.auth, {
      name: "Maria Lopez",
      businessName: "Lopez Roofing",
    });
    const admin = await verify(http, adminPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: admin.auth,
      body: JSON.stringify({ language: "en", name: "Alex" }),
    })).body?.cancel();
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: adminPhone }),
    });
    await boot.body?.cancel();
    expect.eq(boot.status, 200, "Alex is a super admin");
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    // her screen at 390×844: the pill folds to its tab there (p3 is about the tab's ghost)
    const userCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    try {
      const tab = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await tab.goto(`${baseUrl}/dashboard?lang=en`);
      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.goto(`${baseUrl}/admin?lang=en`);
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      const before = await page.evaluate(rowButtons);
      expect(
        before.some((w) => /^Demo$/i.test(w)),
        `the row's buttons before the click: ${JSON.stringify(before)}`,
      );
      // p2 — the row's buttons sampled as fast as the page answers, through the Opening… state
      const rows: string[][] = [];
      const t0 = Date.now();
      const sample = (async () => {
        while (Date.now() - t0 < 1_500) {
          const r = await page.evaluate(rowButtons).catch(() => null);
          if (r) rows.push(r);
          else break; // the page moved to the stage
        }
      })();
      await page.locator("[data-cy='adm-demo']").first().click();
      await sample;
      await Deno.writeTextFile(
        `${folder}/row-samples.json`,
        JSON.stringify(rows, null, 1),
      );
      const opening = rows.filter((r) => r.some((w) => /Opening/i.test(w)));
      expect(opening.length > 0, `Demo said Opening… (${rows.length} samples)`);
      const spilled = opening.filter((r) => r.some((w) => w === "…"));
      expect(
        spilled.length === 0,
        `p2: no other button of the row reads "…" while Demo says Opening…: ${
          JSON.stringify(spilled.slice(0, 3))
        }`,
      );
      await page.waitForURL((u: URL) => u.pathname === "/demo/stage", {
        timeout: 25_000,
      });
      await page.locator("[data-cy='demo-status']").filter({
        hasText: /^\s*Live\s*$/,
      }).waitFor({ timeout: 25_000 });
      await tab.locator("[data-cy='demo-pill']").waitFor({ timeout: 20_000 });
      await tab.waitForTimeout(1_000);
      // m3 — a native confirm() on her screen; it is held open ~1.5 s, then dismissed
      const text = "Delete this quote? It is marked deleted — support can recover it.";
      let dismissed = false;
      tab.once("dialog", async (d: { message(): string; dismiss(): Promise<void> }) => {
        await page.waitForTimeout(1_500);
        expect.eq(d.message(), text, "the dialog is the one her page opened");
        await d.dismiss();
        dismissed = true;
      });
      await tab.evaluate((msg: string) => {
        setTimeout(() => {
          (globalThis as unknown as { __answer: boolean }).__answer = confirm(msg);
        }, 50);
      }, text);
      const chip = page.locator("[data-cy='demo-native-dialog']");
      await chip.waitFor({ timeout: 5_000 });
      const said = (await chip.textContent() ?? "").replace(/\s+/g, " ").trim();
      await page.screenshot({ path: `${folder}/stage-native-dialog.png` });
      expect(
        said.includes("Delete this quote?"),
        `m3: the stage says the dialog's words in its chrome row ("${said}")`,
      );
      expect(!dismissed, "the chip showed while the dialog was still open");
      await chip.waitFor({ state: "detached", timeout: 5_000 });
      expect(dismissed, "the chip went when the dialog was answered");
      const answer = await tab.evaluate(() =>
        (globalThis as unknown as { __answer: boolean }).__answer
      );
      expect.eq(answer, false, "her page got the dialog's answer (dismissed: false)");
      // p3 — her pill folded to its tab, the stage drawing the tab's ghost; Alex ends it from the
      // stage: under "The demo ended" no ghost of her TAB
      await tab.locator("[data-cy='demo-pill'][data-tucked]").waitFor({
        timeout: 30_000,
      });
      await page.locator("[data-cy='demo-pill-ghost-tab-label']").first().waitFor({
        timeout: 10_000,
      });
      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-confirm']").click();
      const endedSamples: { at: number; ended: boolean; ghost: number }[] = [];
      const t1 = Date.now();
      while (Date.now() - t1 < 1_400) {
        const s = await page.evaluate(() => ({
          ended: /The demo ended/.test(document.body.innerText),
          ghost: document.querySelectorAll("[data-cy='demo-pill-ghost-tab-label']").length,
        })).catch(() => null);
        if (!s) break; // hopped to /admin
        endedSamples.push({ at: Date.now() - t1, ...s });
        await page.waitForTimeout(60);
      }
      await Deno.writeTextFile(
        `${folder}/ended-samples.json`,
        JSON.stringify(endedSamples, null, 1),
      );
      const ended = endedSamples.filter((s) => s.ended);
      expect(ended.length > 0, `the stage said the demo ended (${endedSamples.length} samples)`);
      const withGhost = ended.filter((s) => s.ghost > 0);
      expect(
        withGhost.length === 0,
        `p3: no ghost of her folded tab under "The demo ended": ${JSON.stringify(withGhost.slice(0, 4))}`,
      );
    } finally {
      await userCtx.close();
    }
  }));
