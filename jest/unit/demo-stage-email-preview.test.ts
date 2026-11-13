/**
 * REQ-780 (demo-loop cycle dv1, d6) — the send dialog's email preview is visible on the
 * presenter's stage, not a blank box. Raphael: "The email preview should not be blank on the
 * presenter screen."
 *
 * The customer's send dialog renders "What they'll get" as `<iframe sandbox="" srcdoc=EMAIL>`
 * (SendLangPreview). The mirror used to drop every embedded page's srcdoc (REQ-242), so the
 * stage showed an empty box. Now an iframe's srcdoc crosses — cleaned of scripts, handlers,
 * nested frames, refresh metas and `javascript:` URLs on both ends — and the stage builds it as
 * a frame sandboxed with `allow-same-origin` and never `allow-scripts` (inside the stage frame,
 * whose sandbox and CSP it inherits), so nothing of the email runs. A frame's `src` still never
 * crosses, and nor does anything of a frame/object/embed.
 */
import { createRecorder } from "../../front-end/lib/demo-mode/mirror-record";
import { createReplayer } from "../../front-end/lib/demo-mode/mirror-replay";
import {
  cleanEmbedDoc,
  MAX_EMBED_DOC_CHARS,
  type MirrorFrame,
  parseMirrorFrame,
} from "../../shared/demo-mode/mirror";
import {
  docWith,
  FakeMutationObserver,
  FDocument,
  FElement,
  find,
  FNode,
  h,
} from "./support/fake-dom";

const EMAIL = `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
  `<meta http-equiv="refresh" content="0;url=https://evil.example/">` +
  `<base href="https://evil.example/">` +
  `<style>p{color:#333}</style>` +
  `<script>parent.parent.steal()</script></head>` +
  `<body><p>Hola Rosa, aquí está su cotización.</p>` +
  `<img src="https://app.test/logo.png" onerror="steal()" alt="Logo">` +
  `<a href="javascript:steal()">Ver</a>` +
  `<a href="https://app.test/q/abc">Ver cotización</a>` +
  `<iframe src="https://evil.example/"></iframe>` +
  `<object data="x.swf"></object><embed src="x.swf">` +
  `<SCRIPT type="module">steal()</SCRIPT></body></html>`;

function record(doc: FDocument, out: MirrorFrame[]) {
  return createRecorder(doc as unknown as Document, {
    emit: (f) => out.push(JSON.parse(JSON.stringify(f))),
    Observer: FakeMutationObserver as unknown as typeof MutationObserver,
    manual: true,
  });
}

function stageDoc(): FDocument {
  const d = new FDocument("about:srcdoc", 1, 1);
  d.appendChild(h(d, "html", {}, h(d, "head"), h(d, "body")));
  return d;
}

/** the customer's send dialog with the email preview open */
function sendDialog(srcdoc: string) {
  return docWith(
    (d) =>
      h(
        d,
        "html",
        { lang: "es" },
        h(d, "head"),
        h(
          d,
          "body",
          {},
          h(
            d,
            "dialog",
            { class: "send-dialog", open: "" },
            h(d, "iframe", {
              class: "send-dialog__preview-frame",
              "data-cy": "send-preview-email",
              sandbox: "",
              srcdoc,
            }),
            h(d, "iframe", { class: "other", src: "/q/abc" }),
            h(d, "object", { data: "x.swf", srcdoc: "<p>no</p>" } as Record<
              string,
              string
            >),
          ),
        ),
      ),
    "https://app.test/quotes/abc",
  );
}

const frameOf = (d: FDocument, cls: string) =>
  find(d as unknown as FNode, (e) => e.getAttribute("class") === cls) as
    | FElement
    | null;

function assertClean(html: string) {
  expect(html).toContain("Hola Rosa, aquí está su cotización.");
  expect(html).toContain("p{color:#333}");
  expect(html).toContain(`href="https://app.test/q/abc"`);
  expect(html).toContain(`src="https://app.test/logo.png"`);
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/steal\(\)/);
  expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  expect(html).not.toMatch(/javascript:/i);
  expect(html).not.toMatch(/http-equiv/i);
  expect(html).not.toMatch(/<base/i);
  expect(html).not.toMatch(/<(iframe|object|embed|frame)\b/i);
  expect(html).not.toContain("evil.example");
}

describe("REQ-780 (cycle dv1, d6): the email preview's srcdoc crosses to the stage, cleaned", () => {
  test("cleanEmbedDoc keeps the email's text, styles, images and links; drops scripts, handlers, refresh/base, nested frames and javascript: URLs", () => {
    assertClean(cleanEmbedDoc(EMAIL) ?? "");
    // an unclosed script swallows nothing of the stage: everything after it goes
    expect(cleanEmbedDoc(`<p>ok</p><script>steal()`)).toBe(`<p>ok</p>`);
    // a document too big to send is not sent
    expect(cleanEmbedDoc("x".repeat(MAX_EMBED_DOC_CHARS + 1))).toBeNull();
  });

  test("the snapshot carries the preview frame's srcdoc, cleaned; the stage builds it sandboxed without scripts", () => {
    const doc = sendDialog(EMAIL);
    const frames: MirrorFrame[] = [];
    record(doc, frames).snapshot();
    expect(frames.length).toBe(1);
    // the wire's own validation lets it through
    expect(parseMirrorFrame(frames[0])).not.toBeNull();

    const stage = stageDoc();
    const rep = createReplayer(stage as unknown as Document);
    expect(rep.apply(frames[0])).toBe(true);
    const f = frameOf(stage, "send-dialog__preview-frame");
    expect(f).not.toBeNull();
    assertClean(f!.getAttribute("srcdoc") ?? "");
    expect(f!.getAttribute("sandbox")).toBe("allow-same-origin");
    // a frame's src still never crosses; nor does an object's srcdoc
    const other = frameOf(stage, "other");
    expect(other!.getAttribute("src")).toBeNull();
    const obj = find(
      stage as unknown as FNode,
      (e) => e.localName === "object",
    ) as FElement;
    expect(obj.getAttribute("srcdoc")).toBeNull();
    expect(obj.getAttribute("data")).toBeNull();
  });

  test("a language switch (the srcdoc changes) reaches the stage as an op, cleaned", () => {
    const doc = sendDialog(`<p>Hello Rosa</p>`);
    const frames: MirrorFrame[] = [];
    const r = record(doc, frames);
    r.snapshot();
    const stage = stageDoc();
    const rep = createReplayer(stage as unknown as Document);
    expect(rep.apply(frames[0])).toBe(true);
    expect(
      frameOf(stage, "send-dialog__preview-frame")!.getAttribute("srcdoc"),
    ).toBe(`<p>Hello Rosa</p>`);

    frameOf(doc, "send-dialog__preview-frame")!.setAttribute("srcdoc", EMAIL);
    r.flush();
    expect(frames.length).toBe(2);
    expect(parseMirrorFrame(frames[1])).not.toBeNull();
    expect(rep.apply(frames[1])).toBe(true);
    assertClean(
      frameOf(stage, "send-dialog__preview-frame")!.getAttribute("srcdoc") ??
        "",
    );
  });

  test("the stage never lets a frame run scripts, whatever a frame says (forged ops)", () => {
    const stage = stageDoc();
    const rep = createReplayer(stage as unknown as Document);
    const root = {
      i: 1,
      t: "html",
      c: [{ i: 2, t: "head" }, {
        i: 3,
        t: "body",
        c: [{
          i: 4,
          t: "iframe",
          a: {
            sandbox: "allow-scripts allow-same-origin",
            srcdoc: `<p>hi</p><script>steal()</script>`,
          },
        }],
      }],
    };
    expect(rep.apply({ t: "snap", w: 400, h: 400, u: "/", root, ops: [] }))
      .toBe(true);
    const f = find(
      stage as unknown as FNode,
      (e) => e.localName === "iframe",
    ) as FElement;
    expect(f.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(f.getAttribute("srcdoc")).toBe(`<p>hi</p>`);
    expect(rep.apply({
      t: "ops",
      ops: [
        { o: "a", i: 4, n: "sandbox", v: "allow-scripts" },
        { o: "a", i: 4, n: "SANDBOX", v: null },
        { o: "a", i: 4, n: "srcdoc", v: `<b onclick="x()">x</b>` },
      ],
    })).toBe(true);
    expect(f.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(f.getAttribute("srcdoc")).toBe(`<b>x</b>`);
  });
});
