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
 *
 * REQ-862 (demo-loop cycle dm4, p7): the chip sits on or beside its control, in the control's own
 * row, and never over the text right under it (the date's helper line, the next field's label);
 * it is set in the frame body's font, not the system-ui stack.
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

/** the stage's chip of `kind` beside/on the stage's copy of `at`: its words, whether it shows, sits
 *  in `at`'s row, stays clear of the text `next` (the line under the control) and uses the frame
 *  body's font */
const stageChip = ([kind, at, next]: [string, string, string]) => {
  const d = (document.getElementById("stage") as HTMLIFrameElement)
    .contentDocument!;
  const c = d.querySelector(`[data-mirror-picker="${kind}"]`);
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const a = d.querySelector(at)!.getBoundingClientRect();
  const range = d.createRange();
  range.selectNodeContents(d.querySelector(next)!);
  const t = range.getBoundingClientRect();
  const cs = getComputedStyle(c);
  return {
    text: c.textContent,
    visible: r.width > 0 && r.height > 0 && cs.visibility !== "hidden",
    // centred on the control's row (a chip taller than the control overhangs it evenly)
    inRow: Math.abs((r.top + r.bottom) / 2 - (a.top + a.bottom) / 2) <= 1,
    clear: !(r.left < t.right && t.left < r.right && r.top < t.bottom &&
      t.top < r.bottom),
    appFont: cs.fontFamily === getComputedStyle(d.body).fontFamily &&
      !/^system-ui/.test(cs.fontFamily),
  };
};
const noChip = () =>
  !(document.getElementById("stage") as HTMLIFrameElement).contentDocument!
    .querySelector("[data-mirror-picker]");

Deno.test("REQ-827 (cycle dm2, s1) + REQ-862 (cycle dm4, p7): a date picker or file chooser the customer opens shows as a chip on/beside the field on the stage within 1 s, clear of the text under it and in the app font, and closes when the value is chosen", (t) =>
  story(t, async ({ page, expect, folder }) => {
    const js = await mirrorBundle();
    await page.setViewportSize({ width: 900, height: 700 });
    // any page of the app's origin: the stage frame is same-origin with it
    await page.goto("/clients.css");
    await page.addScriptTag({ content: js });
    await page.evaluate(async () => {
      document.body.style.fontFamily = '"Inter", Arial, sans-serif';
      document.body.innerHTML = `<div style="padding:40px;font-size:16px">` +
        `<p><label>Start <input id="when" type="date"></label><br>` +
        `<small id="when-help">November 16, 2026</small></p>` +
        `<p style="margin-bottom:0"><label id="logo-btn" style="display:inline-block;padding:8px 12px;border:1px solid #888">` +
        `Upload logo<input id="logo" type="file" hidden></label></p>` +
        `<p id="lang-label" style="margin:6px 0 16px">APP LANGUAGE</p>` +
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
    const date = await within(page, 1_000, stageChip, [
      "date",
      "#when",
      "#when-help",
    ]);
    await page.screenshot({ path: `${folder}/picker-1-date.png` });
    expect.eq(
      JSON.stringify(date),
      JSON.stringify({
        text: "Choosing a date…",
        visible: true,
        inRow: true,
        clear: true,
        appFont: true,
      }),
      "REQ-827/862: the stage draws 'Choosing a date…' on/beside the date input within 1 s, clear of its helper line, in the app font",
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
    const file = await within(page, 1_000, stageChip, [
      "file",
      "#logo-btn",
      "#lang-label",
    ]);
    await page.screenshot({ path: `${folder}/picker-2-file.png` });
    expect.eq(
      JSON.stringify(file),
      JSON.stringify({
        text: "Customer is choosing a file…",
        visible: true,
        inRow: true,
        clear: true,
        appFont: true,
      }),
      "REQ-827/862: the stage draws 'Customer is choosing a file…' beside the logo button within 1 s, clear of the next label, in the app font",
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

/** REQ-878 — the stage's file chip against SettingsPage's own markup: where it sits relative to
 *  the button (`btn`), its text (a Range over it) and the row's hint (`hint`, a Range) */
const settingsChip = ([btn, hint]: [string, string]) => {
  const d = (document.getElementById("stage") as HTMLIFrameElement)
    .contentDocument!;
  const c = d.querySelector('[data-mirror-picker="file"]');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const textOf = (sel: string) => {
    const range = d.createRange();
    range.selectNodeContents(d.querySelector(sel)!);
    return Array.from(range.getClientRects());
  };
  const clearOf = (rs: DOMRect[]) =>
    rs.every((t) =>
      !(r.left < t.right && t.left < r.right && r.top < t.bottom &&
        t.top < r.bottom)
    );
  const vw = d.defaultView!.innerWidth;
  return {
    visible: r.width > 0 && r.height > 0,
    inFrame: r.left >= 0 && r.right <= vw,
    clearOfButton: clearOf([d.querySelector(btn)!.getBoundingClientRect()]),
    clearOfButtonText: clearOf(textOf(btn)),
    clearOfHint: clearOf(textOf(hint)),
  };
};

Deno.test("REQ-878 (cycle dm5, p2): a file chooser opened from a SIBLING button (SettingsPage's logo and certificate rows: button + display:none input + hint in a full-width flex row) draws the stage chip clear of the hint and of the button's text", (t) =>
  story(t, async ({ page, expect, folder }) => {
    const js = await mirrorBundle();
    await page.setViewportSize({ width: 1400, height: 800 });
    await page.goto("/clients.css");
    await page.addScriptTag({ content: js });
    await page.evaluate(async () => {
      document.body.style.fontFamily = '"Inter", Arial, sans-serif';
      document.body.style.margin = "0";
      // SettingsPage.tsx's rows, verbatim in shape: the input is the button's display:none
      // sibling and the button's onClick calls input.click()
      document.body.innerHTML =
        `<div style="padding:40px 40px 40px 260px;font-size:14px;display:grid;grid-template-columns:1fr 1fr;gap:16px">` +
        `<div id="logo" style="grid-column:1 / -1;display:flex;flex-wrap:wrap;align-items:center;gap:12px">` +
        `<button id="logo-btn" type="button" style="padding:10px 16px">Subir logo</button>` +
        `<input id="logo-file" type="file" style="display:none">` +
        `<span id="logo-hint" style="font-size:12px">PNG, JPG, GIF o WebP · máx. 8 MB · aparece en cotizaciones y facturas</span>` +
        `</div>` +
        `<p style="margin:0">Nombre y dirección del negocio</p>` +
        `<div><div id="cert-row" style="margin-top:14px;display:flex;align-items:center;gap:12px">` +
        `<button id="cert-btn" type="button" style="padding:10px 16px">Subir certificado</button>` +
        `<input id="cert-file" type="file" style="display:none">` +
        `<span id="cert-hint" style="font-size:12px">PDF o imagen · prueba de seguro / responsabilidad civil</span>` +
        `</div></div></div>` +
        `<div data-demo-overlay style="position:fixed;right:0;bottom:0">` +
        `<iframe id="stage" sandbox="allow-same-origin" ` +
        `style="width:1280px;height:300px;border:0"></iframe></div>`;
      for (const k of ["logo", "cert"]) {
        document.getElementById(`${k}-btn`)!.addEventListener(
          "click",
          () =>
            (document.getElementById(`${k}-file`) as HTMLInputElement).click(),
        );
      }
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
            .contentDocument!.querySelector("#cert-hint"),
        undefined,
      ),
      true,
      "the stage mirrors the page",
    );
    const want = JSON.stringify({
      visible: true,
      inFrame: true,
      clearOfButton: true,
      clearOfButtonText: true,
      clearOfHint: true,
    });
    for (const k of ["logo", "cert"]) {
      const chooser = page.waitForEvent("filechooser");
      await page.locator(`#${k}-btn`).click();
      const fc = await chooser;
      const got = await within(page, 1_000, settingsChip, [
        `#${k}-btn`,
        `#${k}-hint`,
      ]);
      await page.screenshot({ path: `${folder}/settings-${k}-chip.png` });
      expect.eq(
        JSON.stringify(got),
        want,
        `REQ-878: the ${k} chip sits by its button, clear of the button's text and the row's hint`,
      );
      const png = await Deno.makeTempFile({ suffix: ".png" });
      await Deno.writeFile(png, new Uint8Array([137, 80, 78, 71]));
      await fc.setFiles(png);
      await Deno.remove(png).catch(() => {});
      expect.eq(
        await within(page, 1_000, noChip, undefined),
        true,
        "REQ-827: a chosen file closes the chip",
      );
    }
  }));

/** REQ-862 AMENDMENT 4 (dm11, m1) — the file chip and what it must be clear of, in the frame */
const narrowLogoChip = () => {
  const d = (document.getElementById("stage") as HTMLIFrameElement)
    .contentDocument!;
  const c = d.querySelector('[data-mirror-picker="file"]');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const box = (sel: string) => d.querySelector(sel)!.getBoundingClientRect();
  const textOf = (sel: string) => {
    const range = d.createRange();
    range.selectNodeContents(d.querySelector(sel)!);
    return Array.from(range.getClientRects());
  };
  const clearOf = (rs: DOMRect[]) =>
    rs.every((t) =>
      !(r.left < t.right && t.left < r.right && r.top < t.bottom &&
        t.top < r.bottom)
    );
  return {
    visible: r.width > 0 && r.height > 0,
    inFrame: r.left >= 0 && r.right <= d.defaultView!.innerWidth,
    wrapped: r.width <= 195 && r.height > 30,
    clearOfButton: clearOf([box("#logo-btn")]),
    clearOfThumbnail: clearOf([box("#logo-img")]),
    clearOfCaption: clearOf(textOf("#logo-set")),
    clearOfHint: clearOf(textOf("#logo-hint")),
    clearOfNextLabel: clearOf(textOf("#lang-label")),
    clearOfSelect: clearOf([box("#lang")]),
    chip: [r.left, r.top, r.width, r.height].map(Math.round).join(","),
    text: c.textContent,
  };
};

Deno.test("REQ-862 AMENDMENT 4 (demo-loop run 11, m1): at 390 px the logo row with a logo uploaded (the thumbnail and 'Logo cargado' wrap under the 'Reemplazar logo' button, the hint under that, the language field next) — the file chip wraps to at most half the frame and sits clear of the button, the thumbnail, its caption, the hint and the next label, inside the frame", (t) =>
  story(t, async ({ page, expect, folder }) => {
    const js = await mirrorBundle();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/clients.css");
    await page.addScriptTag({ content: js });
    await page.evaluate(async () => {
      document.body.style.fontFamily = '"Inter", Arial, sans-serif';
      document.body.style.margin = "0";
      const logo = "data:image/svg+xml;utf8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="106" height="64"><rect width="106" height="64" fill="#345"/></svg>',
        );
      // SettingsPage.tsx at 390 px as run 11's tester measured it: the 159 px button, then the
      // thumbnail + caption on their own line, the two-line hint, the language field
      document.body.innerHTML =
        `<div style="padding:16px 43px;font-size:14px;display:grid;grid-template-columns:1fr;gap:16px">` +
        `<label style="display:block"><span style="display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7560;margin-bottom:6px">Gastos generales por visita</span>` +
        `<input id="overhead" style="width:100%;box-sizing:border-box;padding:10px;font-size:14px" value="0.00">` +
        `<span style="display:block;margin-top:4px;font-size:12px;color:#6b7560">Un cargo fijo por visita que se suma a cada cotización. $ = una cantidad en dólares por visita. 0 = ninguno.</span></label>` +
        `<div id="logo" style="grid-column:1 / -1;display:flex;flex-wrap:wrap;align-items:center;gap:12px">` +
        `<button id="logo-btn" type="button" aria-label="Reemplazar logo" style="padding:12px 25px;font-size:14px;font-family:inherit">Reemplazar logo</button>` +
        `<input id="logo-file" type="file" style="display:none">` +
        `<span id="logo-set" style="display:inline-flex;align-items:center;gap:8px;font-size:12px;color:#6b7560">` +
        `<img id="logo-img" src="${logo}" alt="Logo cargado" style="max-height:32px;max-width:96px;object-fit:contain;border-radius:4px">Logo cargado</span>` +
        `<span id="logo-hint" style="font-size:12px;color:#6b7560">PNG, JPG, GIF o WebP · máx. 8 MB · aparece en cotizaciones y facturas</span>` +
        `</div>` +
        `<label style="display:block"><span id="lang-label" style="display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7560;margin-bottom:6px">Idioma de la app</span>` +
        `<select id="lang" style="width:100%;padding:10px;font-size:14px"><option>Español</option></select></label>` +
        `</div>` +
        `<div data-demo-overlay style="position:fixed;left:0;top:0;opacity:0.01;pointer-events:none">` +
        `<iframe id="stage" sandbox="allow-same-origin" style="width:390px;height:844px;border:0"></iframe></div>`;
      document.getElementById("logo-btn")!.addEventListener(
        "click",
        () =>
          (document.getElementById("logo-file") as HTMLInputElement).click(),
      );
      // deno-lint-ignore no-explicit-any
      const mm = (globalThis as any).__mm;
      const f = document.getElementById("stage") as HTMLIFrameElement;
      const loaded = new Promise((r) => f.addEventListener("load", r));
      f.srcdoc = mm.rep.MIRROR_SRCDOC;
      await loaded;
      // the Spanish stage's words (REQ-827's pickerLabel): the 249 px chip the tester saw
      const replay = mm.rep.createReplayer(f.contentDocument!, {
        pickerLabel: () => "El cliente está eligiendo un archivo…",
      });
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
            .contentDocument!.querySelector("#lang-label"),
        undefined,
      ),
      true,
      "the stage mirrors the page",
    );
    // the row wrapped as on the tester's phone: the thumbnail under the button, not beside it
    const wrapped = await page.evaluate(() => {
      const b = document.getElementById("logo-btn")!.getBoundingClientRect();
      const i = document.getElementById("logo-img")!.getBoundingClientRect();
      return i.top >= b.bottom;
    });
    expect(wrapped, "the thumbnail row wraps under the button at 390 px");
    const chooser = page.waitForEvent("filechooser");
    await page.locator("#logo-btn").click();
    const fc = await chooser;
    const want = {
      visible: true,
      inFrame: true,
      wrapped: true,
      clearOfButton: true,
      clearOfThumbnail: true,
      clearOfCaption: true,
      clearOfHint: true,
      clearOfNextLabel: true,
      clearOfSelect: true,
    };
    const keys = Object.keys(want) as (keyof typeof want)[];
    const t0 = Date.now();
    let got = await page.evaluate(narrowLogoChip);
    while (
      !(got && keys.every((k) => got![k] === want[k])) &&
      Date.now() - t0 < 1_500
    ) {
      await page.waitForTimeout(50);
      got = await page.evaluate(narrowLogoChip);
    }
    await page.screenshot({ path: `${folder}/logo-chip-390.png` });
    expect.eq(
      JSON.stringify(
        got && Object.fromEntries(keys.map((k) => [k, got![k]])),
      ),
      JSON.stringify(want),
      `m1: the wrapped chip clear of the row at 390 px (${
        JSON.stringify(got)
      })`,
    );
    const png = await Deno.makeTempFile({ suffix: ".png" });
    await Deno.writeFile(png, new Uint8Array([137, 80, 78, 71]));
    await fc.setFiles(png);
    await Deno.remove(png).catch(() => {});
  }));

Deno.test("REQ-862 AMENDMENT 5 (demo-loop run 11, m1 — the dense page): at 390 px with the thumbnail's caption as wide as the row, not even the wrapped chip has a clear spot — the frame's chip is hidden and the replayer tells the stage the chip's words (named) with inside:false; the chooser closing tells it null", (t) =>
  story(t, async ({ page, expect }) => {
    const js = await mirrorBundle();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/clients.css");
    await page.addScriptTag({ content: js });
    await page.evaluate(async () => {
      document.body.style.fontFamily = '"Inter", Arial, sans-serif';
      document.body.style.margin = "0";
      const logo = "data:image/svg+xml;utf8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="106" height="64"><rect width="106" height="64" fill="#345"/></svg>',
        );
      const field = (label: string, hint: string) =>
        `<label style="display:block"><span style="display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7560;margin-bottom:6px">${label}</span>` +
        `<input style="width:100%;box-sizing:border-box;padding:10px;font-size:14px" value="0.00">` +
        `<span style="display:block;margin-top:4px;font-size:12px;color:#6b7560">${hint}</span></label>`;
      document.body.innerHTML =
        `<div style="padding:16px 43px;font-size:14px;display:grid;grid-template-columns:1fr;gap:16px">` +
        field(
          "Tarifa por hora",
          "Lo que cobras por hora de trabajo; se usa en las cotizaciones y en los acuerdos que firma el cliente.",
        ) +
        field(
          "Margen",
          "% sobre los materiales. Se suma a cada partida de la cotización.",
        ) +
        field(
          "Gastos generales por visita",
          "Un cargo fijo por visita que se suma a cada cotización. $ = una cantidad en dólares por visita. 0 = ninguno.",
        ) +
        `<div id="logo" style="grid-column:1 / -1;display:flex;flex-wrap:wrap;align-items:center;gap:12px">` +
        `<button id="logo-btn" type="button" aria-label="Reemplazar logo" style="padding:12px 25px;font-size:14px;font-family:inherit">Reemplazar logo</button>` +
        `<input id="logo-file" type="file" style="display:none">` +
        `<span id="logo-set" style="display:inline-flex;align-items:center;gap:8px;font-size:12px;color:#6b7560">` +
        `<img id="logo-img" src="${logo}" alt="Logo cargado" style="max-height:32px;max-width:96px;object-fit:contain;border-radius:4px">Logo cargado · Ruiz Remodelación y Construcción</span>` +
        `<span id="logo-hint" style="font-size:12px;color:#6b7560">PNG, JPG, GIF o WebP · máx. 8 MB · aparece en cotizaciones y facturas</span>` +
        `</div>` +
        field(
          "Idioma de la app",
          "El idioma de los menús y los mensajes. Los documentos siguen el idioma del cliente.",
        ) +
        field(
          "Zona horaria",
          "Para las fechas de tus documentos y recordatorios.",
        ) +
        field(
          "Moneda",
          "Se muestra en cotizaciones y facturas. Cambiarla no convierte montos.",
        ) +
        field(
          "Impuesto",
          "El porcentaje que se aplica a las partidas gravables.",
        ) +
        field(
          "Días de pago",
          "Cuántos días tiene el cliente para pagar una factura.",
        ) +
        field("Prefijo de factura", "Va delante del número de cada factura.") +
        `</div>` +
        `<div data-demo-overlay style="position:fixed;left:0;top:0;opacity:0.01;pointer-events:none">` +
        `<iframe id="stage" sandbox="allow-same-origin" style="width:390px;height:844px;border:0"></iframe></div>`;
      document.getElementById("logo-btn")!.addEventListener(
        "click",
        () =>
          (document.getElementById("logo-file") as HTMLInputElement).click(),
      );
      // deno-lint-ignore no-explicit-any
      const mm = (globalThis as any).__mm;
      const f = document.getElementById("stage") as HTMLIFrameElement;
      const loaded = new Promise((r) => f.addEventListener("load", r));
      f.srcdoc = mm.rep.MIRROR_SRCDOC;
      await loaded;
      // deno-lint-ignore no-explicit-any
      (globalThis as any).__told = [];
      const replay = mm.rep.createReplayer(f.contentDocument!, {
        pickerLabel: () => "El cliente está eligiendo un archivo…",
        // deno-lint-ignore no-explicit-any
        onPicker: (p: unknown) => (globalThis as any).__told.push(p),
      });
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
            .contentDocument!.querySelector("#logo-hint"),
        undefined,
      ),
      true,
      "the stage mirrors the page",
    );
    const chooser = page.waitForEvent("filechooser");
    await page.locator("#logo-btn").click();
    const fc = await chooser;
    const read = () => {
      const d = (document.getElementById("stage") as HTMLIFrameElement)
        .contentDocument!;
      const c = d.querySelector('[data-mirror-picker="file"]');
      const rect = (el: Element | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return [r.left, r.top, r.width, r.height].map(Math.round);
      };
      return {
        chip: c ? rect(c) : null,
        set: rect(d.querySelector("#logo-set")),
        hint: rect(d.querySelector("#logo-hint")),
        btn: rect(d.querySelector("#logo-btn")),
        hidden: !!c && /display:none/.test(c.getAttribute("style") ?? ""),
        // deno-lint-ignore no-explicit-any
        told: (globalThis as any).__told as unknown[],
      };
    };
    const t0 = Date.now();
    let got = await page.evaluate(read);
    while (!(got.hidden && got.told.length) && Date.now() - t0 < 1_500) {
      await page.waitForTimeout(50);
      got = await page.evaluate(read);
    }
    expect(
      got.hidden,
      `the frame's chip is hidden on the dense page (${JSON.stringify(got)})`,
    );
    expect.eq(
      JSON.stringify(got.told[0]),
      JSON.stringify({
        kind: "file",
        text: "El cliente está eligiendo un archivo… · Reemplazar logo",
        inside: false,
      }),
      "the stage is told the chip's words, named, outside",
    );
    const png = await Deno.makeTempFile({ suffix: ".png" });
    await Deno.writeFile(png, new Uint8Array([137, 80, 78, 71]));
    await fc.setFiles(png);
    await Deno.remove(png).catch(() => {});
    const t1 = Date.now();
    let last = await page.evaluate(read);
    while (
      last.told[last.told.length - 1] !== null && Date.now() - t1 < 1_500
    ) {
      await page.waitForTimeout(50);
      last = await page.evaluate(read);
    }
    expect.eq(
      last.told[last.told.length - 1],
      null,
      `the chooser closing tells the stage null (${JSON.stringify(last.told)})`,
    );
  }));
