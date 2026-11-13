/**
 * REQ-806 — `deno task ops`: Claude's side of the approve-link door.
 *
 *   ask  "<phone | name | business>" --reason "<why>"
 *        → the 7133 phone is texted an approve link; this waits (up to 10 min) for the tap, then
 *          keeps the read-only 30-minute view's session in ~/.config/documonster-ops/view.json
 *          (0600). The session is never printed.
 *   view <path> …  [--out <dir>]
 *        → opens each path in its own headless browser as that view (every write aborted) and
 *          saves a full-page screenshot + the page text; a path ending in /pdf is saved as a PDF.
 *   end  → forgets the view (it dies by itself after 30 minutes either way).
 */
import { createRequire } from "node:module";
import {
  blocksRequest,
  outName,
  parseOpsArgs,
  viewCookie,
} from "../shared/ops/tool.ts";

const DIR = `${Deno.env.get("HOME")}/.config/documonster-ops`;
const STATE = `${DIR}/view.json`;
interface View {
  base: string;
  account?: string;
  sessionId: string;
  expiresAt: string;
}

async function ask(base: string, account: string, reason: string) {
  const r = await fetch(`${base}/api/ops/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account, reason }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`ask refused: ${r.status} ${JSON.stringify(body)}`);
  }
  console.log(`asked (${body.id}). Waiting for the tap on the 7133 phone…`);
  const until = Date.parse(body.expiresAt) + 5_000;
  while (Date.now() < until) {
    await new Promise((res) => setTimeout(res, 3_000));
    const p = await (await fetch(`${base}/api/ops/requests/${body.id}`, {
      headers: { "x-ops-poll": body.pollToken },
    })).json();
    if (p.status === "pending") continue;
    if (p.status === "approved" && p.sessionId) {
      await Deno.mkdir(DIR, { recursive: true, mode: 0o700 });
      const view: View = {
        base,
        account: p.account,
        sessionId: p.sessionId,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      };
      await Deno.writeTextFile(STATE, JSON.stringify(view), { mode: 0o600 });
      await Deno.chmod(STATE, 0o600);
      console.log(
        `approved: read-only view of ${p.account} until ${view.expiresAt}`,
      );
      return;
    }
    throw new Error(`not approved: ${p.status}`);
  }
  throw new Error("not approved: expired");
}

async function view(paths: string[], out: string | undefined) {
  const v: View = JSON.parse(
    await Deno.readTextFile(STATE).catch(() => "null"),
  );
  if (!v || Date.now() > Date.parse(v.expiresAt)) {
    throw new Error("no live view — run `deno task ops ask …` first");
  }
  const dir = out ?? await Deno.makeTempDir({ prefix: "ops-view-" });
  await Deno.mkdir(dir, { recursive: true });
  // playwright-core is CommonJS: required from its cached package (the same one shots runs);
  // OPS_PLAYWRIGHT names another copy
  const pwDir = Deno.env.get("OPS_PLAYWRIGHT") ??
    `${
      Deno.env.get("HOME")
    }/Library/Caches/deno/npm/registry.npmjs.org/playwright-core/1.64.1`;
  const require = createRequire(import.meta.url);
  // deno-lint-ignore no-explicit-any
  const { chromium } = require(pwDir) as { chromium: any };
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await ctx.addCookies([viewCookie(v.base, v.sessionId), {
      name: "pm_lang",
      value: "en",
      domain: new URL(v.base).hostname,
      path: "/",
    }]);
    // deno-lint-ignore no-explicit-any
    await ctx.route(
      "**/*",
      (route: any) =>
        blocksRequest(v.base, route.request().method(), route.request().url())
          ? route.abort()
          : route.continue(),
    );
    const page = await ctx.newPage();
    for (const [i, path] of paths.entries()) {
      const name = `${dir}/${outName(i, path)}`;
      if (/\/pdf(\?|$)/.test(path)) {
        const res = await ctx.request.get(`${v.base}${path}`);
        await Deno.writeFile(`${name}.pdf`, new Uint8Array(await res.body()));
        console.log(`${path} → ${res.status()} ${name}.pdf`);
        continue;
      }
      const res = await page.goto(`${v.base}${path}`, { waitUntil: "load" });
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: `${name}.png`, fullPage: true });
      await Deno.writeTextFile(`${name}.txt`, await page.innerText("body"));
      console.log(`${path} → ${res?.status()} ${name}.png (+ .txt)`);
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  try {
    const a = parseOpsArgs(Deno.args);
    if (a.cmd === "ask") await ask(a.base, a.account, a.reason);
    else if (a.cmd === "view") await view(a.paths, a.out);
    else {
      await Deno.remove(STATE).catch(() => {});
      console.log("view forgotten");
    }
  } catch (e) {
    console.error((e as Error).message);
    Deno.exit(1);
  }
}
