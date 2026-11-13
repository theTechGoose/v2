/**
 * REQ-601 (demo cycle 4, issue M12) — on the real pages, an invite whose text
 * could not go out (a reserved 555-01XX number, REQ-523) shows what to share:
 * /field/workers shows the /worker sign-in link, the PIN just typed, and a
 * "Copy link + PIN" button that copies the welcome text; /admins shows the
 * sign-in link and a Copy button for the invite text.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const area = () => String(200 + Math.floor(Math.random() * 700));
const two = () => String(Math.floor(Math.random() * 100)).padStart(2, "0");

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Hank Miller" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  await page.context().grantPermissions(
    ["clipboard-read", "clipboard-write"],
    { origin: new URL(baseUrl).origin },
  );
}

Deno.test("REQ-601 (demo M12): a worker who couldn't be texted — the page shows the link, the PIN and Copy link + PIN", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.goto("/field/workers");
    await page.locator("[data-cy='wk-form']").waitFor({ timeout: 20_000 });
    await page.getByText("No workers yet.").waitFor({ timeout: 20_000 });
    await page.locator("[data-cy='wk-name']").fill("Luis Ortega");
    await page.locator("[data-cy='wk-phone']").fill(`${area()}55501${two()}`);
    await page.locator("[data-cy='wk-pin']").fill("4826");
    await page.locator("[data-cy='wk-add']").click();
    const said = page.locator("[data-cy='wk-texted']");
    await said.waitFor({ timeout: 15_000 });
    expect.eq(await said.getAttribute("data-texted"), "false", "not texted");

    const share = page.locator("[data-cy='wk-share']");
    await share.waitFor({ timeout: 10_000 });
    const url = (await page.locator("[data-cy='wk-share-url']").innerText())
      .trim();
    expect(
      /^https?:\/\/[^ ]+\/worker\b/.test(url),
      `the sign-in link is on the page (got "${url}")`,
    );
    expect(
      (await page.locator("[data-cy='wk-share-pin']").innerText()).includes(
        "4826",
      ),
      "the PIN just typed is on the page",
    );
    // REQ-735 (demo c5 p6): the link and the copy box are styled, not UA defaults
    const look = await page.evaluate(() => {
      const css = (s: string) => getComputedStyle(document.querySelector(s)!);
      const a = css("[data-cy='wk-share-url']");
      const ta = css("[data-cy='wk-share-text']");
      return { aColor: a.color, aWeight: a.fontWeight, taFont: ta.fontFamily };
    });
    expect(
      look.aColor !== "rgb(0, 0, 238)",
      `share link not UA blue (${look.aColor})`,
    );
    expect.eq(look.aColor, "rgb(26, 83, 92)", "share link is brand teal");
    expect(Number(look.aWeight) >= 600, `share link weight ${look.aWeight}`);
    expect(/Inter/.test(look.taFont), `share text box font (${look.taFont})`);
    const copy = page.locator("[data-cy='wk-share-copy']");
    expect.eq((await copy.innerText()).trim(), "Copy link + PIN", "the button");
    await copy.click();
    await page.locator("[data-cy='wk-share-copy'][data-copied='true']")
      .waitFor({ timeout: 10_000 });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.includes(url), `the copied text carries the link (${clip})`);
    expect(clip.includes("4826"), "the copied text carries the PIN");
    expect(clip.includes("Hank Miller"), "…and who added them, like the SMS");
  }));

Deno.test("REQ-601 (demo M12): an editor invite that couldn't be texted shows the sign-in link and Copy", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.goto("/admins");
    await page.locator("[data-cy='adm-phone']").fill(`${area()}55501${two()}`);
    await page.locator("[data-cy='adm-name']").fill("Carol Miller");
    const invite = page.locator("[data-cy='adm-invite']:not([disabled])");
    await invite.waitFor({ timeout: 20_000 });
    await invite.click();
    const sent = page.locator("[data-cy='adm-sent']");
    await sent.waitFor({ timeout: 15_000 });
    expect.eq(await sent.getAttribute("data-texted"), "false", "not texted");
    await page.locator("[data-cy='adm-share']").waitFor({ timeout: 10_000 });
    const url = (await page.locator("[data-cy='adm-share-url']").innerText())
      .trim();
    expect(/^https?:\/\/\S+/.test(url), `the sign-in link is shown (${url})`);
    await page.locator("[data-cy='adm-share-copy']").click();
    await page.locator("[data-cy='adm-share-copy'][data-copied='true']")
      .waitFor({ timeout: 10_000 });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.includes(url), `the copied invite carries the link (${clip})`);
  }));
