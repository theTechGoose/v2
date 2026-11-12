/**
 * REQ-242 — the DOM mirror end to end on a fake DOM: the customer's recorder snapshots its
 * document and then streams the changes; every frame crosses a JSON round trip (the wire); the
 * stage's replayer builds it. What the customer's screen shows is what the replay shows — the
 * assistant's bubbles, a dialog and the text typed in it, toasts, flips, the language — minus
 * what must never cross: scripts, <noscript>, the demo overlay, the staff banner, comments,
 * preloads, refresh metas, tracking pixels, embedded pages; secrets are masked.
 */
import { createRecorder } from "../../front-end/lib/demo-mode/mirror-record";
import { createReplayer } from "../../front-end/lib/demo-mode/mirror-replay";
import type { MirrorFrame } from "../../shared/demo-mode/mirror";
import {
  canon,
  docWith,
  FakeMutationObserver,
  FCharacterData,
  FDocument,
  FElement,
  find,
  findAll,
  FNode,
  h,
  walk,
} from "./support/fake-dom";

type Rec = ReturnType<typeof createRecorder>;
type Rep = ReturnType<typeof createReplayer>;

/** a recorder on `doc` whose frames go over a JSON round trip into `out` */
function record(doc: FDocument, out: MirrorFrame[]): Rec {
  return createRecorder(doc as unknown as Document, {
    emit: (f) => out.push(JSON.parse(JSON.stringify(f))),
    Observer: FakeMutationObserver as unknown as typeof MutationObserver,
    manual: true,
  });
}

/** the stage's frame: the srcdoc document the replayer is handed (html/head/body, a CSP meta) */
function stageDoc(): FDocument {
  const d = new FDocument("about:srcdoc", 1, 1);
  d.appendChild(
    h(
      d,
      "html",
      {},
      h(
        d,
        "head",
        {},
        h(d, "meta", {
          "http-equiv": "Content-Security-Policy",
          content: "script-src 'none'",
        }),
      ),
      h(d, "body"),
    ),
  );
  return d;
}

function replay(): { doc: FDocument; rep: Rep } {
  const doc = stageDoc();
  const rep = createReplayer(doc as unknown as Document, {
    paintCanvas: (c, url) => {
      (c as unknown as FElement).painted = url;
    },
  });
  return { doc, rep };
}

/** a fresh snapshot of `doc`, replayed: what a stage joining now would show */
function fresh(doc: FDocument): string {
  const frames: MirrorFrame[] = [];
  const r = record(doc, frames);
  r.snapshot();
  r.stop();
  const { doc: d, rep } = replay();
  expect(rep.apply(frames[0])).toBe(true);
  return canon(d);
}

function applyAll(rep: Rep, frames: MirrorFrame[], from: number): number {
  for (let k = from; k < frames.length; k++) {
    expect({ frame: k, ok: rep.apply(frames[k]) }).toEqual({
      frame: k,
      ok: true,
    });
  }
  return frames.length;
}

/** the customer's page: an assistant thread, inputs of every kind, and everything that must not cross */
function customerPage() {
  return docWith(
    (d) =>
      h(
        d,
        "html",
        { lang: "en" },
        h(
          d,
          "head",
          {},
          h(d, "meta", { charset: "utf-8" }),
          h(d, "meta", {
            "http-equiv": "refresh",
            content: "0;url=https://evil.example/",
          }),
          h(d, "title", {}, "DocuMonster"),
          h(d, "link", {
            rel: "stylesheet",
            href: "/assets/app.css",
            integrity: "sha384-x",
            crossorigin: "",
          }),
          h(d, "link", { rel: "modulepreload", href: "/assets/island.js" }),
          h(d, "link", { rel: "icon", href: "favicon.png" }),
          h(
            d,
            "style",
            {},
            ".hero{background:url(img/bg.png)} .x{background:url('data:image/png;base64,AA')}",
          ),
          h(d, "script", { src: "/assets/app.js" }),
          h(d, "base", { href: "https://evil.example/" }),
        ),
        h(
          d,
          "body",
          { class: "app" },
          h(
            d,
            "noscript",
            {},
            h(d, "iframe", {
              src: "https://www.googletagmanager.com/ns.html?id=GTM-X",
            }),
          ),
          h(d, "div", { "data-demo-skip": "" }, "Impersonating Ana"),
          h(
            d,
            "main",
            { class: "chat" },
            d.createComment("frsh:island:AsstChat:0") as unknown as FNode,
            h(d, "h1", {
              onclick: "steal()",
              style: "background-image:url(/static/hero.png)",
            }, "Hi Ana"),
            h(d, "a", { href: "/customers?tab=all" }, "Customers"),
            h(d, "a", { href: "javascript:alert(1)" }, "Bad"),
            h(d, "a", { href: "#top" }, "Top"),
            h(d, "img", {
              src: "logo.png",
              srcset: "logo.png 1x, logo@2x.png 2x",
              alt: "Logo",
            }),
            h(d, "img", {
              src: "https://www.facebook.com/tr?id=1&ev=PageView",
              width: "1",
              height: "1",
            }),
            h(d, "iframe", {
              src: "/q/abc",
              srcdoc: "<p>x</p>",
              class: "welcome__sample-frame",
            }),
            h(
              d,
              "svg:svg",
              { viewBox: "0 0 10 10" },
              h(d, "svg:use", { href: "#ic-home" }),
              h(d, "svg:linearGradient", { id: "g" }),
            ),
            h(d, "textarea", { class: "composer__input" }),
            h(d, "input", { name: "q", value: "default" }),
            h(d, "input", { type: "password", name: "pw", value: "hunter2" }),
            h(d, "input", { autocomplete: "one-time-code", name: "pin" }),
            h(d, "input", { type: "checkbox", checked: "" }),
            h(
              d,
              "select",
              {},
              h(d, "option", { value: "a" }, "A"),
              h(d, "option", { value: "b" }, "B"),
            ),
            h(
              d,
              "div",
              { "data-demo-mask": "" },
              h(d, "span", {}, "4111 1111"),
            ),
            h(d, "canvas", { width: "200", height: "80", class: "sig" }),
          ),
          h(
            d,
            "div",
            { "data-demo-overlay": "" },
            h(d, "div", { "data-cy": "demo-pill" }, "Hans is guiding you"),
          ),
          h(d, "script", {}, "window.x = 1"),
        ),
      ),
    "https://app.test/assistant/abc?x=1",
    420,
    800,
  );
}

const el = (doc: FDocument, pred: (e: FElement) => boolean) => {
  const e = find(doc, pred);
  if (!e) throw new Error("no such element");
  return e;
};

describe("REQ-242 the snapshot", () => {
  test("the stage's replay is the customer's page — no script, noscript, overlay, banner, comment, preload, refresh, base or pixel; URLs absolute; embedded pages empty; secrets masked; state carried", () => {
    const doc = customerPage();
    const by = (n: string) => el(doc, (e) => e.getAttribute("name") === n);
    el(doc, (e) => e.localName === "textarea").value =
      "Replace the kitchen sink";
    by("q").value = "typed";
    by("pin").value = "1234";
    el(doc, (e) => e.getAttribute("type") === "checkbox").checked = false;
    el(doc, (e) => e.localName === "select").value = "b";
    el(doc, (e) => e.localName === "main").scrollTop = 35;
    el(doc, (e) => e.localName === "canvas").bitmap =
      "data:image/png;base64,SIG";
    doc.defaultView.scrollY = 240;

    const frames: MirrorFrame[] = [];
    record(doc, frames).snapshot();
    expect(frames.length).toBe(1);
    const f = frames[0];
    expect(f.t).toBe("snap");
    if (f.t !== "snap") return;
    expect({ w: f.w, h: f.h, u: f.u }).toEqual({
      w: 420,
      h: 800,
      u: "/assistant/abc?x=1",
    });

    const { doc: stage, rep } = replay();
    expect(rep.apply(f)).toBe(true);
    expect(rep.size()).toEqual({ w: 420, h: 800 });
    expect(rep.path()).toBe("/assistant/abc?x=1");
    expect(canon(stage)).toBe(
      `<html lang="en" :scroll=0,240>` +
        `<head><meta charset="utf-8"></meta><title>DocuMonster</title>` +
        `<link crossorigin="" href="https://app.test/assets/app.css" rel="stylesheet"></link>` +
        `<link href="https://app.test/assistant/favicon.png" rel="icon"></link>` +
        `<style>.hero{background:url(https://app.test/assistant/img/bg.png)} .x{background:url('data:image/png;base64,AA')}</style>` +
        `</head>` +
        `<body class="app"><main class="chat" :scroll=0,35>` +
        `<h1 style="background-image:url(https://app.test/static/hero.png)">Hi Ana</h1>` +
        `<a href="https://app.test/customers?tab=all">Customers</a>` +
        `<a href="#">Bad</a>` +
        `<a href="#top">Top</a>` +
        `<img alt="Logo" src="https://app.test/assistant/logo.png" srcset="https://app.test/assistant/logo.png 1x, https://app.test/assistant/logo@2x.png 2x"></img>` +
        `<iframe class="welcome__sample-frame"></iframe>` +
        `<svg:svg viewBox="0 0 10 10"><svg:use href="#ic-home"></svg:use><svg:linearGradient id="g"></svg:linearGradient></svg:svg>` +
        `<textarea class="composer__input" :value="Replace the kitchen sink"></textarea>` +
        `<input name="q" value="default" :value="typed"></input>` +
        `<input name="pw" type="password" value="•••••••" :value="•••••••"></input>` +
        `<input autocomplete="one-time-code" name="pin" :value="••••"></input>` +
        `<input checked="" type="checkbox" :value="" :checked=false></input>` +
        `<select :value="b"><option value="a">A</option><option value="b">B</option></select>` +
        `<div data-demo-mask=""><span>•••• ••••</span></div>` +
        `<canvas class="sig" height="80" width="200" :painted="data:image/png;base64,SIG"></canvas>` +
        `</main></body></html>`,
    );
    // the frame's own CSP meta went with the old root; nothing of the srcdoc's shell is left
    expect(findAll(stage, (e) => e.localName === "meta").length).toBe(1);
  });

  test("nothing secret is in the frame at all — not in an attribute, not in a text, not in an op", () => {
    const doc = customerPage();
    el(doc, (e) => e.getAttribute("name") === "pin").value = "9876";
    const frames: MirrorFrame[] = [];
    record(doc, frames).snapshot();
    const wire = JSON.stringify(frames);
    for (
      const secret of [
        "hunter2",
        "9876",
        "4111",
        "steal()",
        "javascript:",
        "evil.example",
        "GTM-X",
        "facebook.com",
        "window.x",
        "island.js",
        "Hans is guiding you",
        "Impersonating",
      ]
    ) {
      expect({ secret, onTheWire: wire.includes(secret) }).toEqual({
        secret,
        onTheWire: false,
      });
    }
  });
});

describe("REQ-242 the changes", () => {
  test("B1/M1/M7/M9 — a chat bubble, the composer cleared by code, a dialog with typed text, a toast, a card flip, a text change and the language all reach the stage", () => {
    const doc = customerPage();
    const frames: MirrorFrame[] = [];
    const rec = record(doc, frames);
    rec.snapshot();
    const { doc: stage, rep } = replay();
    let at = applyAll(rep, frames, 0);

    const main = el(doc, (e) => e.localName === "main");
    const body = el(doc, (e) => e.localName === "body");
    const composer = el(doc, (e) => e.localName === "textarea");
    composer.value = "Replace the kitchen sink";
    doc.fire("input", composer);
    rec.flush();
    at = applyAll(rep, frames, at);
    expect(el(stage, (e) => e.localName === "textarea").value).toBe(
      "Replace the kitchen sink",
    );

    main.appendChild(
      h(doc, "div", { class: "msg msg--user" }, "Replace the kitchen sink"),
    );
    composer.value = ""; // the island clears it by code: no input event
    const card = h(doc, "div", { class: "card" }, "Option A");
    main.appendChild(card);
    rec.flush();
    at = applyAll(rep, frames, at);

    const dialog = h(
      doc,
      "div",
      { role: "dialog", "aria-modal": "true", "data-cy": "transfer-modal" },
      h(doc, "label", {}, "New owner's phone"),
      h(doc, "input", { "data-cy": "transfer-phone", type: "tel" }),
    );
    body.insertBefore(
      dialog,
      el(doc, (e) => e.hasAttribute("data-demo-overlay")),
    );
    const phone = el(
      doc,
      (e) => e.getAttribute("data-cy") === "transfer-phone",
    );
    phone.value = "5125550000";
    doc.fire("input", phone);
    body.appendChild(h(doc, "div", { class: "toast" }, "Saved"));
    card.setAttribute("class", "card card--flipped");
    (el(doc, (e) => e.localName === "h1").childNodes[0] as FCharacterData)
      .data = "Hola Ana";
    el(doc, (e) => e.localName === "html").setAttribute("lang", "es");
    rec.flush();
    at = applyAll(rep, frames, at);

    expect(canon(stage)).toBe(fresh(doc));
    const s = (pred: (e: FElement) => boolean) => find(stage, pred);
    expect(s((e) => e.getAttribute("class") === "msg msg--user")?.textContent)
      .toBe("Replace the kitchen sink");
    expect(s((e) => e.localName === "textarea")?.value).toBe("");
    expect(s((e) => e.getAttribute("role") === "dialog")).not.toBeNull();
    expect(s((e) => e.getAttribute("data-cy") === "transfer-phone")?.value)
      .toBe("5125550000");
    expect(s((e) => e.getAttribute("class") === "toast")?.textContent).toBe(
      "Saved",
    );
    expect(s((e) => e.getAttribute("class") === "card card--flipped")).not
      .toBeNull();
    expect(s((e) => e.localName === "h1")?.textContent).toBe("Hola Ana");
    expect(s((e) => e.localName === "html")?.getAttribute("lang")).toBe("es");
  });

  test("moves, removals, and a node changed while it was out of the page and put back, all replay to the page as it is", () => {
    const doc = customerPage();
    const frames: MirrorFrame[] = [];
    const rec = record(doc, frames);
    rec.snapshot();
    const { doc: stage, rep } = replay();
    let at = applyAll(rep, frames, 0);
    const main = el(doc, (e) => e.localName === "main");
    const body = el(doc, (e) => e.localName === "body");

    // a list reordered (keyed moves)
    const ul = h(
      doc,
      "ul",
      {},
      h(doc, "li", {}, "1"),
      h(doc, "li", {}, "2"),
      h(doc, "li", {}, "3"),
    );
    main.appendChild(ul);
    rec.flush();
    at = applyAll(rep, frames, at);
    ul.insertBefore(ul.childNodes[2], ul.childNodes[0]);
    rec.flush();
    at = applyAll(rep, frames, at);
    expect(canon(stage)).toBe(fresh(doc));

    // a child moved out of a subtree that is then removed, in one batch
    const box = h(
      doc,
      "section",
      {},
      h(doc, "p", {}, "keep me"),
      h(doc, "p", {}, "drop me"),
    );
    main.appendChild(box);
    rec.flush();
    at = applyAll(rep, frames, at);
    body.insertBefore(box.childNodes[0], body.childNodes[0]);
    box.remove();
    rec.flush();
    at = applyAll(rep, frames, at);
    expect(canon(stage)).toBe(fresh(doc));

    // out of the page across a flush, changed while out, then back: it comes back as it is now
    const card = h(doc, "div", { class: "card" }, h(doc, "b", {}, "v1"));
    main.appendChild(card);
    rec.flush();
    at = applyAll(rep, frames, at);
    card.remove();
    rec.flush();
    at = applyAll(rep, frames, at);
    (card.childNodes[0].childNodes[0] as FCharacterData).data = "v2";
    card.setAttribute("class", "card card--new");
    main.appendChild(card);
    rec.flush();
    at = applyAll(rep, frames, at);
    expect(canon(stage)).toBe(fresh(doc));
    expect(
      find(stage, (e) => e.getAttribute("class") === "card card--new")
        ?.textContent,
    ).toBe("v2");

    // and the same within one batch
    card.remove();
    (card.childNodes[0].childNodes[0] as FCharacterData).data = "v3";
    body.appendChild(card);
    rec.flush();
    applyAll(rep, frames, at);
    expect(canon(stage)).toBe(fresh(doc));
  });

  test("what never crosses stays out when it changes later: a script appended, the overlay's pointer moving, the banner — no frame at all", () => {
    const doc = customerPage();
    const frames: MirrorFrame[] = [];
    const rec = record(doc, frames);
    rec.snapshot();
    const overlay = el(doc, (e) => e.hasAttribute("data-demo-overlay"));
    const pointer = h(doc, "div", {
      "data-cy": "demo-pointer",
      style: "transform:translate(1px,2px)",
    });
    overlay.appendChild(pointer);
    pointer.setAttribute("style", "transform:translate(5px,9px)");
    el(doc, (e) => e.hasAttribute("data-demo-skip")).setAttribute("class", "x");
    el(doc, (e) => e.localName === "head").appendChild(
      h(doc, "script", { src: "https://connect.facebook.net/fbevents.js" }),
    );
    rec.flush();
    expect(frames.length).toBe(1);
  });

  test("the URL (pushState), the viewport and scrolls — the window's and an element's", () => {
    const doc = customerPage();
    const frames: MirrorFrame[] = [];
    const rec = record(doc, frames);
    rec.snapshot();
    const { doc: stage, rep } = replay();
    let at = applyAll(rep, frames, 0);
    doc.defaultView.go("https://app.test/assistant/7f3c");
    doc.defaultView.innerWidth = 390;
    doc.defaultView.fire("resize");
    const main = el(doc, (e) => e.localName === "main");
    main.scrollTop = 80;
    doc.fire("scroll", main);
    doc.defaultView.scrollY = 12;
    doc.fire("scroll", doc);
    rec.flush();
    at = applyAll(rep, frames, at);
    expect(rep.path()).toBe("/assistant/7f3c");
    expect(rep.size()).toEqual({ w: 390, h: 800 });
    expect(find(stage, (e) => e.localName === "main")?.scrollTop).toBe(80);
    expect(stage.documentElement?.scrollTop).toBe(12);
  });

  test("a password typed is masked on the way out", () => {
    const doc = customerPage();
    const frames: MirrorFrame[] = [];
    const rec = record(doc, frames);
    rec.snapshot();
    const pw = el(doc, (e) => e.getAttribute("name") === "pw");
    pw.value = "s3cret!";
    doc.fire("input", pw);
    rec.flush();
    expect(JSON.stringify(frames)).not.toContain("s3cret");
    const { doc: stage, rep } = replay();
    applyAll(rep, frames, 0);
    expect(find(stage, (e) => e.getAttribute("name") === "pw")?.value).toBe(
      "•••••••",
    );
  });

  test("paused, nothing goes out; the next snapshot starts over; stopped, every listener is gone", () => {
    const doc = customerPage();
    const frames: MirrorFrame[] = [];
    const rec = record(doc, frames);
    rec.snapshot();
    rec.pause();
    el(doc, (e) => e.localName === "main").appendChild(
      h(doc, "p", {}, "while nobody watched"),
    );
    rec.flush();
    expect(frames.length).toBe(1);
    rec.snapshot();
    expect(frames.length).toBe(2);
    expect(frames[1].t).toBe("snap");
    rec.stop();
    expect(
      doc.listening("input") + doc.listening("change") +
        doc.listening("scroll"),
    ).toBe(0);
    expect(doc.defaultView.listening("resize")).toBe(0);
    expect(doc.observers.size).toBe(0);
  });
});

describe("REQ-242 a random walk: the incremental replay always equals a fresh snapshot", () => {
  test("300 rounds of inserts, removals, moves, attribute and text changes, typed values and detached edits", () => {
    let seed = 0x5eed;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
    const doc = customerPage();
    const body = el(doc, (e) => e.localName === "body");
    const frames: MirrorFrame[] = [];
    const rec = record(doc, frames);
    rec.snapshot();
    const { doc: stage, rep } = replay();
    let at = applyAll(rep, frames, 0);
    const TAGS = [
      "div",
      "span",
      "p",
      "ul",
      "li",
      "section",
      "button",
      "input",
      "textarea",
      "script",
      "noscript",
      "style",
    ];
    const ATTRS = [
      "class",
      "title",
      "data-x",
      "hidden",
      "aria-label",
      "onclick",
      "style",
      "href",
      "src",
    ];
    const parked: FNode[] = [];
    const elements = () => {
      const out: FElement[] = [];
      walk(body, (e) => out.push(e));
      return [body, ...out];
    };
    const nodes = () => {
      const out: FNode[] = [];
      const go = (n: FNode) =>
        n.childNodes.forEach((c) => (out.push(c), go(c)));
      go(body);
      return out;
    };
    const make = (depth = 0): FNode => {
      if (rnd() < 0.3) return doc.createTextNode(`t${Math.floor(rnd() * 1e4)}`);
      const e = h(
        doc,
        pick(TAGS),
        rnd() < 0.5 ? { [pick(ATTRS)]: `v${Math.floor(rnd() * 100)}` } : {},
      );
      if (depth < 2) {
        for (let k = Math.floor(rnd() * 3); k > 0; k--) {
          e.appendChild(make(depth + 1));
        }
      }
      return e;
    };
    for (let round = 0; round < 300; round++) {
      for (let k = 1 + Math.floor(rnd() * 4); k > 0; k--) {
        const r = rnd();
        if (r < 0.25) {
          const p = pick(elements());
          p.insertBefore(make(), pick([...p.childNodes, null]));
        } else if (r < 0.4) {
          const n = pick(nodes());
          if (n) n.remove();
        } else if (r < 0.55) {
          const n = pick(nodes());
          const p = pick(elements());
          if (n && !n.contains(p)) {
            p.insertBefore(
              n,
              pick([...p.childNodes.filter((c) => c !== n), null]),
            );
          }
        } else if (r < 0.7) {
          const e = pick(elements());
          if (rnd() < 0.7) {
            e.setAttribute(pick(ATTRS), `v${Math.floor(rnd() * 100)}`);
          } else e.removeAttribute(pick(ATTRS));
        } else if (r < 0.8) {
          const t = nodes().filter((n) => n.nodeType === 3);
          if (t.length) {
            (pick(t) as FCharacterData).data = `x${Math.floor(rnd() * 1e4)}`;
          }
        } else if (r < 0.88) {
          const ins = elements().filter((e) =>
            e.localName === "input" || e.localName === "textarea"
          );
          if (ins.length) {
            const i = pick(ins);
            i.value = `typed ${Math.floor(rnd() * 1e4)}`;
            if (rnd() < 0.5) doc.fire("input", i);
          }
        } else if (r < 0.94) {
          // taken out of the page, edited while out, kept for later
          const n = pick(nodes());
          if (n && n.nodeType === 1) {
            n.remove();
            (n as FElement).setAttribute("data-out", String(round));
            n.appendChild(make(2));
            parked.push(n);
          }
        } else if (parked.length) {
          const p = pick(elements());
          const n = parked.splice(Math.floor(rnd() * parked.length), 1)[0];
          if (!n.contains(p)) p.appendChild(n);
        }
      }
      rec.flush();
      at = applyAll(rep, frames, at);
      expect({ round, same: canon(stage) === fresh(doc) }).toEqual({
        round,
        same: true,
      });
    }
  });
});

describe("REQ-242 scrolls survive the replay's styles loading late", () => {
  test("a scroll the replay could not take yet (an element is a scroller only once its stylesheet is in) is taken again when the replay settles; the latest one wins", () => {
    const doc = customerPage();
    const main = el(doc, (e) => e.localName === "main");
    main.scrollTop = 35;
    doc.defaultView.scrollY = 240;
    const frames: MirrorFrame[] = [];
    const rec = record(doc, frames);
    rec.snapshot();
    const { doc: stage, rep } = replay();
    applyAll(rep, frames, 0);
    const twin = el(stage, (e) => e.localName === "main");
    // the browser dropped both: no layout yet
    twin.scrollTop = 0;
    stage.documentElement!.scrollTop = 0;
    rep.settle();
    expect(twin.scrollTop).toBe(35);
    expect(stage.documentElement!.scrollTop).toBe(240);
    // a later scroll replaces the remembered one
    main.scrollTop = 90;
    doc.fire("scroll", main);
    rec.flush();
    applyAll(rep, frames, 1);
    twin.scrollTop = 0;
    rep.settle();
    expect(twin.scrollTop).toBe(90);
  });
});

describe("REQ-242 a desync is reported, never papered over", () => {
  test("ops before any snapshot, or naming a node the replay does not have, fail", () => {
    const { rep } = replay();
    expect(rep.apply({ t: "ops", ops: [{ o: "x", i: 4, x: "hi" }] })).toBe(
      false,
    );
    const doc = customerPage();
    const frames: MirrorFrame[] = [];
    record(doc, frames).snapshot();
    expect(rep.apply(frames[0])).toBe(true);
    expect(rep.apply({ t: "ops", ops: [{ o: "k", i: 99_999, c: [] }] })).toBe(
      false,
    );
    expect(rep.apply({ t: "ops", ops: [{ o: "k", i: 1, c: [99_998] }] })).toBe(
      false,
    );
    expect(
      rep.apply({ t: "ops", ops: [{ o: "a", i: 99_997, n: "class", v: "x" }] }),
    ).toBe(false);
  });
});

describe("REQ-242 M4 — the pointer is anchored to the same node on both screens", () => {
  test("the customer's node → its id → the stage's node; a point → the node under it and the fraction of its box → back to a point", () => {
    const doc = customerPage();
    const frames: MirrorFrame[] = [];
    const rec = record(doc, frames);
    rec.snapshot();
    const { doc: stage, rep } = replay();
    applyAll(rep, frames, 0);

    const h1 = el(doc, (e) => e.localName === "h1");
    const id = rec.idOf(h1)!;
    expect(id).toBeGreaterThan(0);
    expect(rec.idOf(h1.childNodes[0])).toBe(id); // a text node anchors to its element
    expect(rec.nodeOf(id)).toBe(h1);
    // the overlay is never anchored: its nearest mirrored ancestor is the body
    const pill = el(doc, (e) => e.getAttribute("data-cy") === "demo-pill");
    expect(rec.idOf(pill)).toBe(
      rec.idOf(el(doc, (e) => e.localName === "body")),
    );

    const twin = rep.nodeOf(id) as unknown as FElement;
    expect(twin.localName).toBe("h1");
    expect(twin.textContent).toBe("Hi Ana");
    twin.rect = { left: 40, top: 100, width: 200, height: 50 };
    stage.hit = () => twin;
    expect(rep.anchorAt(90, 110)).toEqual({ id, x: 0.25, y: 0.2 });
    expect(rep.pointOf({ id, x: 0.5, y: 0.5 })).toEqual({ x: 140, y: 125 });
    // a node the stage does not have, or one with no box, gives no point (the fraction is the fallback)
    expect(rep.pointOf({ id: 99_999, x: 0.5, y: 0.5 })).toBeNull();
    twin.rect = { left: 0, top: 0, width: 0, height: 0 };
    expect(rep.pointOf({ id, x: 0.5, y: 0.5 })).toBeNull();
    // nothing mirrored under the point
    stage.hit = () => null;
    expect(rep.anchorAt(5, 5)).toBeNull();
  });
});
