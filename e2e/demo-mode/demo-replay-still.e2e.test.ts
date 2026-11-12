/**
 * REQ-547 — demo-loop cycle 4, issues M21 + m32: after a rejoin the stage showed the customers
 * board's back-of-card text (`.ccard2__panel`) as a ghost over the cards. The replay rebuilt the
 * page from a snapshot, its stylesheet came in a moment later, and the closed panel then FADED
 * from its unstyled look (opacity 1) to its closed one (clients.css: `opacity 240ms`) — a state
 * the customer never had.
 *
 * In a real Chromium, with the app's real clients.css and the stage's real replayer in the
 * stage's sandboxed srcdoc frame (MIRROR_SRCDOC): a snapshot whose sheet loads late never shows
 * the closed panel at any opacity but 0; and a later snapshot (a rejoin onto another page's CSS)
 * keeps the previous page on show until its sheet is in, so no frame shows it half-styled.
 */
import { story } from "#shots";

const ROOT = new URL("../../", import.meta.url);

/** the stage's replayer, bundled for the browser and exposed as `window.__mirror` */
async function replayerBundle(): Promise<string> {
  const dir = await Deno.makeTempDir();
  const entry = `${dir}/entry.ts`;
  await Deno.writeTextFile(
    entry,
    `import * as m from ${
      JSON.stringify(
        new URL("front-end/lib/demo-mode/mirror-replay.ts", ROOT).href,
      )
    };\n(globalThis as unknown as { __mirror: unknown }).__mirror = m;\n`,
  );
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--quiet", "--platform", "browser", "--no-check", entry],
    cwd: new URL(".", ROOT).pathname,
    stdout: "piped",
    stderr: "piped",
  }).output();
  await Deno.remove(dir, { recursive: true });
  if (!out.success) {
    throw new Error(`deno bundle: ${new TextDecoder().decode(out.stderr)}`);
  }
  return new TextDecoder().decode(out.stdout);
}

Deno.test("REQ-547: a replayed snapshot never fades the card's back panel in from its unstyled look, and a rejoin's snapshot never shows half-styled", (t) =>
  story(t, async ({ page, expect }) => {
    const js = await replayerBundle();
    // any page of the app's origin: the stage frame is same-origin with it
    await page.goto("/clients.css");
    await page.addScriptTag({ content: js });
    const r = await page.evaluate(async () => {
      // deno-lint-ignore no-explicit-any
      const m = (globalThis as any).__mirror;
      const f = document.createElement("iframe");
      f.setAttribute("sandbox", "allow-same-origin");
      f.style.cssText = "width:420px;height:800px;border:0";
      const loaded = new Promise((r) => f.addEventListener("load", r));
      f.srcdoc = m.MIRROR_SRCDOC;
      document.body.appendChild(f);
      await loaded;
      const d = f.contentDocument!;
      const w = f.contentWindow!;
      const rep = m.createReplayer(d);
      let id = 1;
      const origin = location.origin;
      /** the /customers page as the customer's browser has it: its two sheets (dashboard.css
       *  carries the --ease-* tokens clients.css's transitions use), and a card */
      const page = (bust: string) => ({
        t: "snap",
        w: 420,
        h: 800,
        u: "/customers",
        ops: [],
        root: {
          i: id++,
          t: "html",
          c: [
            {
              i: id++,
              t: "head",
              c: ["dashboard.css", "clients.css"].map((css) => ({
                i: id++,
                t: "link",
                a: {
                  rel: "stylesheet",
                  href: `${origin}/${css}?req547=${bust}`,
                },
              })),
            },
            {
              i: id++,
              t: "body",
              c: [{
                i: id++,
                t: "article",
                a: { class: "ccard2", style: "position:relative;height:200px" },
                c: [
                  {
                    i: id++,
                    t: "div",
                    a: { class: "ccard2__body" },
                    c: [{ i: id++, x: "Bob Smith" }],
                  },
                  {
                    i: id++,
                    t: "div",
                    a: { class: "ccard2__panel" },
                    c: [{ i: id++, x: "No subscriptions" }],
                  },
                ],
              }],
            },
          ],
        },
      });
      /** every animation frame for `ms`: the panel's look whenever the frame's sheet is in */
      const watch = async (ms: number) => {
        const seen: string[] = [];
        const t0 = performance.now();
        while (performance.now() - t0 < ms) {
          await new Promise((r) => w.requestAnimationFrame(r));
          const p = d.querySelector(".ccard2__panel");
          if (!p) continue;
          const s = w.getComputedStyle(p);
          // clients.css is in once the panel is absolutely placed
          if (s.position !== "absolute") {
            seen.push(`unstyled:${s.opacity}`);
            continue;
          }
          seen.push(`${s.opacity}/${s.visibility}`);
        }
        return seen;
      };
      // 1. the first snapshot: its sheet arrives after the page was built
      rep.apply(page(String(Math.random())));
      const first = await watch(900);
      const shown = d.documentElement;
      // 2. a rejoin: another snapshot, whose sheet the frame does not have yet
      rep.apply(page(String(Math.random())));
      const keptOld = d.documentElement === shown;
      const second = await watch(900);
      return {
        first,
        second,
        keptOld,
        settled: rep.settled(),
        still: rep.still?.() ?? null,
      };
    });
    const bad = (seen: string[]) =>
      seen.filter((s) => s !== "0/hidden" && !s.startsWith("unstyled"));
    const report = JSON.stringify(r);
    expect(r.first.length > 0, `a styled frame was seen: ${report}`);
    // the closed panel is never seen fading: only ever fully closed once styled
    expect.eq(
      bad(r.first).join(","),
      "",
      `the first snapshot's panel never fades from its unstyled look: ${report}`,
    );
    expect.eq(
      bad(r.second).join(","),
      "",
      `the rejoin's panel never fades either: ${report}`,
    );
    // the rejoin kept the previous (styled) page on show: never an unstyled frame
    expect(r.keptOld, `the rejoin kept the previous page on show: ${report}`);
    expect.eq(
      r.second.filter((s) => s.startsWith("unstyled")).join(","),
      "",
      `the rejoin never showed its page unstyled: ${report}`,
    );
    // and once settled, the page's own transitions are back
    expect(r.settled, `the replay settled: ${report}`);
    expect.eq(
      r.still,
      false,
      `its transitions are back once settled: ${report}`,
    );
  }));
