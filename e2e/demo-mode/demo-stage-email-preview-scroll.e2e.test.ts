/**
 * REQ-819 (demo-loop cycle dm1, M3) — scrolling the send dialog's email preview is mirrored, and
 * the customer's pointer over it keeps moving on the stage. Raphael: "fix every issue the demo
 * found, loop until there are none."
 *
 * The demo: the customer scrolled 500px inside "What they'll get"; the stage still showed the
 * top of the email ("Hi John 👋") and the customer's marker froze at the frame's edge. The email
 * was a fixed-height `<iframe sandbox="">` that scrolled in its own document, which the mirror
 * (top document only) never sees, nor the overlay's top-document pointermove.
 *
 * In a real Chromium: the REAL SendPreviewBody (bundled with preact) renders a long email inside
 * a send dialog that scrolls (`max-height` + `overflow-y: auto`, as the app's CSS); the customer's
 * real recorder streams into the stage's real replayer inside the stage's MIRROR_SRCDOC frame.
 *   1. the preview has no scroller of its own: the frame is as tall as its email;
 *   2. the customer wheels 500px over the preview: the DIALOG scrolls (not the email's frame), and
 *      within 1 s the stage's copy shows the same part of the email at the dialog's top;
 *   3. the customer moves the mouse down across the preview: the top document hears every move
 *      (the overlay's pointer source), up to where the mouse rests — not frozen at the edge;
 *   4. the language switch still re-fits the frame (the English email is longer) and reaches the
 *      stage; no script of the email runs.
 */
import { story, type StoryTools } from "#shots";

const ROOT = new URL("../../", import.meta.url);

/** the real preview body + preact, the recorder and the replayer, bundled as `window.__mm` */
async function bundle(): Promise<string> {
  // inside front-end/, so the entry resolves preact through the front-end's import map
  const dir = await Deno.makeTempDir({
    dir: new URL("front-end/", ROOT).pathname,
    prefix: ".req819-bundle-",
  });
  const entry = `${dir}/entry.tsx`;
  // the front-end's config, but client JSX: its "precompile" JSX is server-only templates that
  // preact's client render() draws nothing for
  const cfg = JSON.parse(
    await Deno.readTextFile(new URL("front-end/deno.json", ROOT)),
  );
  delete cfg.tasks;
  cfg.compilerOptions = { ...cfg.compilerOptions, jsx: "react-jsx" };
  await Deno.writeTextFile(`${dir}/deno.json`, JSON.stringify(cfg));
  const fe = (p: string) =>
    JSON.stringify(new URL(`front-end/${p}`, ROOT).href);
  await Deno.writeTextFile(
    entry,
    `/** @jsxImportSource preact */\n` +
      `import { h, render } from "preact";\n` +
      `import { SendPreviewBody } from ${
        fe("components/SendLangPreview.tsx")
      };\n` +
      `import * as rec from ${fe("lib/demo-mode/mirror-record.ts")};\n` +
      `import * as rep from ${fe("lib/demo-mode/mirror-replay.ts")};\n` +
      `const show = (el: Element, html: string, lang: string) => render(h(SendPreviewBody, {\n` +
      `  preview: { lang, email: { to: "rosa@example.com", subject: "Q-001", html } },\n` +
      `  channel: "email", uiLang: "en" }), el);\n` +
      `(globalThis as unknown as { __mm: unknown }).__mm = { rec, rep, show };\n`,
  );
  const out = await new Deno.Command(Deno.execPath(), {
    args: [
      "bundle",
      "--quiet",
      "--platform",
      "browser",
      "--no-check",
      "--config",
      `${dir}/deno.json`,
      entry,
    ],
    cwd: new URL("front-end/", ROOT).pathname,
    stdout: "piped",
    stderr: "piped",
  }).output();
  await Deno.remove(dir, { recursive: true });
  if (!out.success) {
    throw new Error(`deno bundle: ${new TextDecoder().decode(out.stderr)}`);
  }
  return new TextDecoder().decode(out.stdout);
}

type Page = StoryTools["page"];

async function within<T>(page: Page, ms: number, fn: () => T): Promise<T> {
  const t0 = Date.now();
  let v = await page.evaluate(fn);
  while (!v && Date.now() - t0 < ms) {
    await page.waitForTimeout(50);
    v = await page.evaluate(fn);
  }
  return v;
}

/** a long email shaped like the quote email: numbered paragraphs, a script that must not run */
const email = (lang: "en" | "es", n: number) =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
  `<style>body{margin:0;font:15px Arial,sans-serif;color:#222}p{margin:0;height:40px}</style>` +
  `<script>top.document.title = "PWNED"</script></head><body>` +
  `<h1 id="greet" style="margin:0;height:60px">${
    lang === "es" ? "Hola Rosa 👋" : "Hi Rosa 👋"
  }</h1>` +
  Array.from({ length: n }, (_, i) => `<p id="p${i + 1}">${lang}-${i + 1}</p>`)
    .join("") +
  `</body></html>`;

/** which email paragraph sits at the top edge of the (scrolled) send dialog, on a document */
function topLine(d: Document): string | null {
  const dlg = d.querySelector(".send-dialog");
  const f = d.querySelector("[data-cy=send-preview-email]") as
    | HTMLIFrameElement
    | null;
  const inner = f?.contentDocument;
  if (!dlg || !f || !inner?.getElementById("p1")) return null;
  const y = dlg.getBoundingClientRect().top - f.getBoundingClientRect().top +
    (inner.defaultView?.scrollY ?? 0);
  for (const p of inner.querySelectorAll("p")) {
    const r = p.getBoundingClientRect();
    const top = r.top + (inner.defaultView?.scrollY ?? 0);
    if (top + r.height > y) return p.textContent;
  }
  return null;
}

Deno.test("REQ-819 (cycle dm1, M3): scrolling the send dialog's email preview is mirrored on the stage, and the pointer over it is heard", (t) =>
  story(t, async ({ page, expect, folder }) => {
    const js = await bundle();
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.setContent(
      `<!doctype html><html><head></head><body></body></html>`,
    );
    // the app's own send-dialog stylesheets (its max-height + overflow scroll, the frame's rules)
    for (const css of ["quotes.css", "assistant-page.css"]) {
      await page.addStyleTag({
        content: await Deno.readTextFile(
          new URL(`front-end/static/${css}`, ROOT),
        ),
      });
    }
    await page.addScriptTag({ content: js });
    await page.evaluate(
      async ([src, topLineSrc]: string[]) => {
        document.title = "customer";
        document.body.innerHTML =
          `<div class="send-dialog"><p>Send the quote</p><div id="body"></div></div>` +
          `<div data-demo-overlay style="position:fixed;right:0;top:0">` +
          `<iframe id="stage" sandbox="allow-same-origin" ` +
          `style="width:600px;height:600px;border:1px solid #999"></iframe></div>`;
        // deno-lint-ignore no-explicit-any
        const g = globalThis as any;
        g.topLine = new Function(`return (${topLineSrc})`)();
        // the overlay's pointer source: pointermove on the top document, capture
        g.heard = [] as number[];
        document.addEventListener(
          "pointermove",
          (e) => g.heard.push(e.clientY),
          { capture: true },
        );
        g.__mm.show(document.getElementById("body")!, src, "es");
        const f = document.getElementById("stage") as HTMLIFrameElement;
        const loaded = new Promise((r) => f.addEventListener("load", r));
        f.srcdoc = g.__mm.rep.MIRROR_SRCDOC;
        await loaded;
        const replay = g.__mm.rep.createReplayer(f.contentDocument!);
        const recorder = g.__mm.rec.createRecorder(document, {
          emit: (fr: unknown) => replay.apply(JSON.parse(JSON.stringify(fr))),
        });
        recorder.snapshot();
      },
      [email("es", 40), topLine.toString()],
    );

    // 1. the frame is as tall as its email: nothing to scroll inside it
    const fit = await within(page, 2_000, () => {
      const f = document.querySelector(
        "[data-cy=send-preview-email]",
      ) as HTMLIFrameElement;
      const d = f.contentDocument;
      if (!d?.getElementById("p40")) return null;
      const inner = d.documentElement.scrollHeight;
      return Math.abs(f.clientHeight - inner) <= 1 ? "fits" : null;
    });
    const sizes = await page.evaluate(() => {
      const f = document.querySelector(
        "[data-cy=send-preview-email]",
      ) as HTMLIFrameElement;
      return `frame ${f.clientHeight} / email ${f.contentDocument?.documentElement.scrollHeight}`;
    });
    expect.eq(
      fit,
      "fits",
      `REQ-819: the email preview has no scroller of its own (${sizes})`,
    );

    // stage caught up with the snapshot
    await within(page, 1_000, () =>
      // deno-lint-ignore no-explicit-any
      (globalThis as any).topLine(
        (document.getElementById("stage") as HTMLIFrameElement)
          .contentDocument!,
      ));

    // 2. the customer wheels 500px over the preview
    const box = await page.evaluate(() => {
      const r = document.querySelector("[data-cy=send-preview-email]")!
        .getBoundingClientRect();
      const d = document.querySelector(".send-dialog")!.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        top: Math.max(r.top, d.top),
        bottom: Math.min(r.bottom, d.bottom),
      };
    });
    await page.mouse.move(box.x, box.top + 20);
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(400);
    const customer = await page.evaluate(() => {
      const f = document.querySelector(
        "[data-cy=send-preview-email]",
      ) as HTMLIFrameElement;
      return {
        dialog: Math.round(document.querySelector(".send-dialog")!.scrollTop),
        frame: Math.round(f.contentWindow?.scrollY ?? 0),
        // deno-lint-ignore no-explicit-any
        line: (globalThis as any).topLine(document) as string,
      };
    });
    expect.eq(
      customer.frame,
      0,
      `REQ-819: the wheel never scrolls inside the email's frame (dialog ${customer.dialog})`,
    );
    expect.eq(
      customer.dialog > 300,
      true,
      `REQ-819: the wheel over the preview scrolls the send dialog (scrollTop ${customer.dialog})`,
    );
    const stageLine = await within(page, 1_000, () => {
      // deno-lint-ignore no-explicit-any
      const g = globalThis as any;
      const want = g.topLine(document);
      const got = g.topLine(
        (document.getElementById("stage") as HTMLIFrameElement)
          .contentDocument!,
      );
      return got === want ? got : null;
    });
    await page.screenshot({ path: `${folder}/scrolled.png` });
    expect.eq(
      stageLine,
      customer.line,
      "REQ-819: within 1 s the stage shows the same part of the email the customer scrolled to",
    );

    // 3. the pointer moves down across the preview: the top document hears it all the way
    const y0 = Math.round(box.top + 10);
    const y1 = Math.round(box.bottom - 10);
    await page.mouse.move(box.x, y0);
    await page.evaluate(() => {
      // deno-lint-ignore no-explicit-any
      (globalThis as any).heard = [];
    });
    await page.mouse.move(box.x, y1, { steps: 10 });
    const heard = await page.evaluate(() =>
      // deno-lint-ignore no-explicit-any
      ((globalThis as any).heard as number[]).map(Math.round)
    );
    expect.eq(
      heard.length >= 8 && Math.abs(heard[heard.length - 1] - y1) <= 1,
      true,
      `REQ-819: every move over the preview reaches the top document, to where the mouse rests (${y1}); heard ${
        JSON.stringify(heard)
      }`,
    );

    // 4. the language switch re-fits the frame and reaches the stage
    await page.evaluate((en: string) => {
      // deno-lint-ignore no-explicit-any
      (globalThis as any).__mm.show(document.getElementById("body")!, en, "en");
    }, email("en", 60));
    const refit = await within(page, 2_000, () => {
      const f = document.querySelector(
        "[data-cy=send-preview-email]",
      ) as HTMLIFrameElement;
      const d = f.contentDocument;
      if (!d?.getElementById("p60")) return null;
      return Math.abs(f.clientHeight - d.documentElement.scrollHeight) <= 1
        ? "fits"
        : null;
    });
    expect.eq(refit, "fits", "REQ-819: the English email re-fits the frame");
    const stageEn = await within(page, 1_000, () => {
      const d = (document.getElementById("stage") as HTMLIFrameElement)
        .contentDocument!;
      const inner = (d.querySelector("[data-cy=send-preview-email]") as
        | HTMLIFrameElement
        | null)?.contentDocument;
      return inner?.getElementById("p60") ? inner.documentElement.lang : null;
    });
    expect.eq(stageEn, "en", "REQ-819: the stage shows the English email");
    expect.eq(
      await page.evaluate(() => document.title),
      "customer",
      "REQ-819: no script of the email ran",
    );
  }));
