/**
 * REQ-827 (demo-loop cycle dm2, s1) — an open native date picker or file chooser is shown on the
 * stage.
 *
 * Both are drawn outside the DOM (by the browser, by the OS), so the stage showed nothing while
 * the customer chose a date or a file. In a real Chromium, the customer's real recorder streams
 * its document into the stage's real replayer (MIRROR_SRCDOC's sandboxed frame): clicking a date
 * input draws a "Choosing a date…" chip under it on the stage within 1 s and a picked value
 * closes it; clicking a hidden file input's label button draws "Customer is choosing a file…"
 * under the button, and the chosen file closes it. (Modelled on REQ-638's demo-select-open.)
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

/** polls `fn` (in the page) every 50 ms for `ms`: the first truthy answer, or the last one */
async function within<T, A>(
  page: Page,
  ms: number,
  fn: (a: A) => T,
  arg: A,
): Promise<T> {
  const t0 = Date.now();
  // deno-lint-ignore no-explicit-any
  let v = await page.evaluate(fn as any, arg);
  while (!v && Date.now() - t0 < ms) {
    await page.waitForTimeout(50);
    // deno-lint-ignore no-explicit-any
    v = await page.evaluate(fn as any, arg);
  }
  return v as T;
}

/** the stage's chip of `kind`, and whether it is drawn under the stage's copy of `under` */
const stageChip = ([kind, under]: [string, string]) => {
  const d = (document.getElementById("stage") as HTMLIFrameElement)
    .contentDocument!;
  const c = d.querySelector(`[data-mirror-picker="${kind}"]`);
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const a = d.querySelector(under)!.getBoundingClientRect();
  return {
    text: c.textContent,
    visible: r.width > 0 && r.height > 0 &&
      getComputedStyle(c).visibility !== "hidden",
    under: Math.abs(r.left - a.left) < 4 && r.top >= a.bottom - 1 &&
      r.top - a.bottom < 12,
  };
};
const noChip = () =>
  !(document.getElementById("stage") as HTMLIFrameElement).contentDocument!
    .querySelector("[data-mirror-picker]");

Deno.test("REQ-827 (cycle dm2, s1): a date picker or file chooser the customer opens shows as a chip under the field on the stage within 1 s, and closes when the value is chosen", (t) =>
  story(t, async ({ page, expect, folder }) => {
    const js = await mirrorBundle();
    await page.setViewportSize({ width: 900, height: 700 });
    // any page of the app's origin: the stage frame is same-origin with it
    await page.goto("/clients.css");
    await page.addScriptTag({ content: js });
    await page.evaluate(async () => {
      document.body.innerHTML =
        `<div style="padding:40px;font:16px sans-serif">` +
        `<p><label>Start <input id="when" type="date"></label></p>` +
        `<p><label id="logo-btn" style="display:inline-block;padding:8px 12px;border:1px solid #888">` +
        `Upload logo<input id="logo" type="file" hidden></label></p>` +
        `<button id="save" type="button">Save</button></div>` +
        // the stage, on the same page: never recorded (the overlay is never mirrored)
        `<div data-demo-overlay style="position:fixed;right:0;top:0">` +
        `<iframe id="stage" sandbox="allow-same-origin" ` +
        `style="width:420px;height:300px;border:1px solid #999"></iframe></div>`;
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
    });

    expect.eq(
      await within(
        page,
        1_000,
        () =>
          !!(document.getElementById("stage") as HTMLIFrameElement)
            .contentDocument!.querySelector("#when"),
        undefined,
      ),
      true,
      "the stage mirrors the page",
    );
    expect.eq(
      await page.evaluate(noChip),
      true,
      "closed: no chip on the stage",
    );

    // 1. the customer clicks the date input (its picker opens on their screen)
    await page.locator("#when").click();
    const date = await within(page, 1_000, stageChip, ["date", "#when"]);
    await page.screenshot({ path: `${folder}/picker-1-date.png` });
    expect.eq(
      JSON.stringify(date),
      JSON.stringify({ text: "Choosing a date…", visible: true, under: true }),
      "REQ-827: the stage draws 'Choosing a date…' under the date input within 1 s",
    );
    // a picked date (change) closes it
    await page.locator("#when").fill("2026-12-01");
    expect.eq(
      await within(page, 1_000, noChip, undefined),
      true,
      "REQ-827: a picked date closes the chip on the stage",
    );

    // 2. the customer clicks the logo button: the OS file chooser opens
    const chooser = page.waitForEvent("filechooser");
    await page.locator("#logo-btn").click();
    const fc = await chooser;
    const file = await within(page, 1_000, stageChip, ["file", "#logo-btn"]);
    await page.screenshot({ path: `${folder}/picker-2-file.png` });
    expect.eq(
      JSON.stringify(file),
      JSON.stringify({
        text: "Customer is choosing a file…",
        visible: true,
        under: true,
      }),
      "REQ-827: the stage draws 'Customer is choosing a file…' under the logo button within 1 s",
    );
    // the chosen file closes it
    const png = await Deno.makeTempFile({ suffix: ".png" });
    await Deno.writeFile(png, new Uint8Array([137, 80, 78, 71]));
    await fc.setFiles(png);
    await Deno.remove(png).catch(() => {});
    expect.eq(
      await within(page, 1_000, noChip, undefined),
      true,
      "REQ-827: a chosen file closes the chip on the stage",
    );
  }));
