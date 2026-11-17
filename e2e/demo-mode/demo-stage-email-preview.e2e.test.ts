/**
 * REQ-780 (demo-loop cycle dv1, d6) — the send dialog's email preview is visible on the
 * presenter's stage, not a blank box. Raphael: "The email preview should not be blank on the
 * presenter screen."
 *
 * In a real Chromium: the customer's page holds the send dialog's "What they'll get" exactly as
 * SendPreviewBody renders it (`<iframe sandbox="" srcdoc=EMAIL>`, the REQ-461 jest/deno tests pin
 * that markup), the customer's real recorder streams it into the stage's real replayer inside the
 * stage's sandboxed MIRROR_SRCDOC frame. Within 1 s the stage's copy of the preview frame shows
 * the same email — its Spanish text, its language — and after the customer switches to English
 * the English one; a script in the email never runs on the stage, and the frame is laid out at
 * the customer's size (not an empty box).
 */
import { story, type StoryTools } from "#shots";

const ROOT = new URL("../../", import.meta.url);

/** the customer's recorder and the stage's replayer, bundled for the browser as `window.__mm` */
async function mirrorBundle(): Promise<string> {
  const dir = await Deno.makeTempDir();
  const entry = `${dir}/entry.ts`;
  const lib = (p: string) =>
    JSON.stringify(new URL(`front-end/lib/demo-mode/${p}`, ROOT).href);
  await Deno.writeTextFile(
    entry,
    `import * as rec from ${lib("mirror-record.ts")};\n` +
      `import * as rep from ${lib("mirror-replay.ts")};\n` +
      `(globalThis as unknown as { __mm: unknown }).__mm = { rec, rep };\n`,
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

/** an email shaped like the quote email: a styled table layout, a logo, a button, a script */
const email = (lang: "en" | "es") =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
  `<style>body{margin:0;font:15px Arial,sans-serif;color:#222}` +
  `.btn{display:inline-block;background:#FF6B6B;color:#fff;padding:12px 20px}</style>` +
  `<script>top.document.title = "PWNED"; parent.document.title = "PWNED"</script></head>` +
  `<body><table width="100%"><tr><td>` +
  `<h1 id="greet">${
    lang === "es"
      ? "Hola Rosa, aquí está su cotización"
      : "Hi Rosa, here is your quote"
  }</h1>` +
  `<p id="total">Q-001 · $1,250.00</p>` +
  `<a class="btn" href="https://app.test/q/abc" onclick="steal()">${
    lang === "es" ? "Ver cotización" : "View quote"
  }</a>` +
  `<img src="x" onerror="top.document.title='PWNED2'" alt="">` +
  `</td></tr></table></body></html>`;

Deno.test("REQ-780 (cycle dv1, d6): the send dialog's email preview shows on the stage with the customer's text and language, and nothing of it runs", (t) =>
  story(t, async ({ page, expect, folder }) => {
    const js = await mirrorBundle();
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.setContent(
      `<!doctype html><html><head></head><body></body></html>`,
    );
    await page.addScriptTag({ content: js });
    await page.evaluate(async (es: string) => {
      document.title = "customer";
      document.body.innerHTML =
        `<div class="send-dialog" style="padding:20px;width:460px;font:14px sans-serif">` +
        `<p>Subject: <strong>Cotización Q-001</strong></p>` +
        // SendPreviewBody's frame, as it renders
        `<iframe class="send-dialog__preview-frame" data-cy="send-preview-email" ` +
        `title="Cotización Q-001" sandbox="" ` +
        `style="width:420px;height:260px;border:1px solid #ccc"></iframe></div>` +
        // the stage, on the same page: never recorded (the overlay is never mirrored)
        `<div data-demo-overlay style="position:fixed;right:0;top:0">` +
        `<iframe id="stage" sandbox="allow-same-origin" ` +
        `style="width:520px;height:400px;border:1px solid #999"></iframe></div>`;
      (document.querySelector(
        "[data-cy=send-preview-email]",
      ) as HTMLIFrameElement)
        .srcdoc = es;
      // deno-lint-ignore no-explicit-any
      const mm = (globalThis as any).__mm;
      const f = document.getElementById("stage") as HTMLIFrameElement;
      const loaded = new Promise((r) => f.addEventListener("load", r));
      f.srcdoc = mm.rep.MIRROR_SRCDOC;
      await loaded;
      const replay = mm.rep.createReplayer(f.contentDocument!);
      const recorder = mm.rec.createRecorder(document, {
        emit: (fr: unknown) => replay.apply(JSON.parse(JSON.stringify(fr))),
      });
      recorder.snapshot();
    }, email("es"));

    /** what the stage's copy of the preview frame shows */
    const stageEmail = () => {
      const d = (document.getElementById("stage") as HTMLIFrameElement)
        .contentDocument!;
      const f = d.querySelector("[data-cy=send-preview-email]") as
        | HTMLIFrameElement
        | null;
      const inner = f?.contentDocument;
      const h1 = inner?.getElementById("greet");
      if (!f || !inner || !h1) return null;
      const r = f.getBoundingClientRect();
      return {
        greet: h1.textContent,
        lang: inner.documentElement.lang,
        button: inner.querySelector(".btn")?.textContent ?? null,
        buttonBg: getComputedStyle(inner.querySelector(".btn")!)
          .backgroundColor,
        size: `${Math.round(r.width)}x${Math.round(r.height)}`,
        sandbox: f.getAttribute("sandbox"),
        scripts: inner.querySelectorAll("script").length,
        handlers: inner.querySelectorAll("[onclick],[onerror]").length,
      };
    };

    const es = await within(page, 1_000, stageEmail);
    await page.screenshot({ path: `${folder}/stage-email-es.png` });
    expect.eq(
      JSON.stringify(es),
      JSON.stringify({
        greet: "Hola Rosa, aquí está su cotización",
        lang: "es",
        button: "Ver cotización",
        buttonBg: "rgb(255, 107, 107)",
        size: "422x262",
        sandbox: "allow-same-origin",
        scripts: 0,
        handlers: 0,
      }),
      "REQ-780: the stage shows the customer's Spanish email preview within 1 s, styled, at its size, with no script or handler in it",
    );

    // the customer switches "Sends in" to English: the preview frame's srcdoc changes
    await page.evaluate((en: string) => {
      (document.querySelector(
        "[data-cy=send-preview-email]",
      ) as HTMLIFrameElement)
        .srcdoc = en;
    }, email("en"));
    const en = await within(page, 1_000, () => {
      const d = (document.getElementById("stage") as HTMLIFrameElement)
        .contentDocument!;
      const inner = (d.querySelector("[data-cy=send-preview-email]") as
        | HTMLIFrameElement
        | null)?.contentDocument;
      const g = inner?.getElementById("greet")?.textContent;
      return g === "Hi Rosa, here is your quote"
        ? `${g}|${inner!.documentElement.lang}`
        : null;
    });
    await page.screenshot({ path: `${folder}/stage-email-en.png` });
    expect.eq(
      en,
      "Hi Rosa, here is your quote|en",
      "REQ-780: the language switch reaches the stage's preview within 1 s",
    );
    expect.eq(
      await page.evaluate(() => document.title),
      "customer",
      "REQ-780: no script of the email ran (on either screen)",
    );
  }));
