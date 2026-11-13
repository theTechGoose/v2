import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";

/**
 * REQ-354 (demo issue M39, cycle 1) — the "never again" guard.
 *
 * A double-click on "New customer" (or on the quote's "Send") opened its
 * dialog and closed it again: the full-screen backdrop is painted over the
 * opener and closed on ANY click, so the double-click's second click closed
 * it. Every backdrop that dismisses on click now goes through the shared
 * `<Backdrop>` (components/Backdrop.tsx → lib/backdrop-dismiss.ts). This test
 * fails the moment any island/component/route puts a raw `onClick` on a
 * full-screen overlay again — an element whose inline style or CSS class is
 * `position: fixed; inset: 0`.
 */

const root = new URL("../", import.meta.url);

/** classes whose CSS rule is a full-screen fixed overlay */
async function overlayClasses(): Promise<Set<string>> {
  const out = new Set<string>();
  for await (const f of walk(new URL("static/", root), { exts: [".css"] })) {
    const css = (await Deno.readTextFile(f.path)).replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2];
      if (
        !/position\s*:\s*fixed/.test(body) ||
        !/inset\s*:\s*0(\s*[;}]|\s*$)/.test(body)
      ) continue;
      for (const sel of m[1].split(",")) {
        // only the last compound selector is the element itself
        const last = sel.trim().split(/\s+/).pop() ?? "";
        const cls = [...last.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((c) => c[1]);
        // `.a.b` modifiers: the base class is the first one
        if (cls.length) out.add(cls[0]);
      }
    }
  }
  return out;
}

/** every lowercase JSX opening tag in a file, with its line number */
function openingTags(
  src: string,
): { tag: string; attrs: string; line: number }[] {
  const tags: { tag: string; attrs: string; line: number }[] = [];
  const re = /<([a-z][a-z0-9]*)(?=[\s>/])/g;
  for (let m; (m = re.exec(src));) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    tags.push({
      tag: m[1],
      attrs: src.slice(m.index + m[0].length, i),
      line: src.slice(0, m.index).split("\n").length,
    });
  }
  return tags;
}

async function rawBackdropClicks(): Promise<string[]> {
  const classes = await overlayClasses();
  const offenders: string[] = [];
  for (const dir of ["islands/", "components/", "routes/"]) {
    for await (const f of walk(new URL(dir, root), { exts: [".tsx"] })) {
      if (f.path.endsWith("/components/Backdrop.tsx")) continue;
      const src = await Deno.readTextFile(f.path);
      for (const t of openingTags(src)) {
        if (!/\bonClick\s*=/.test(t.attrs)) continue;
        const style = /\bstyle\s*=\s*"([^"]*)"/.exec(t.attrs)?.[1] ?? "";
        const inlineOverlay = /position\s*:\s*fixed/.test(style) &&
          /(^|;)\s*inset\s*:\s*0\s*(;|$)/.test(style);
        const cls = /\bclass\s*=\s*"([^"]*)"/.exec(t.attrs)?.[1] ?? "";
        const classOverlay = cls.split(/\s+/).some((c) => classes.has(c));
        if (inlineOverlay || classOverlay) {
          offenders.push(
            `${
              f.path.slice(new URL(root).pathname.length)
            }:${t.line} <${t.tag} class="${cls}">`,
          );
        }
      }
    }
  }
  return offenders;
}

Deno.test("REQ-354 M39: the CSS scan knows the app's full-screen overlay classes", async () => {
  const classes = await overlayClasses();
  for (
    const c of [
      "send-dialog__backdrop",
      "modal-bg",
      "sb-backdrop",
      // REQ-384 (m16): "chat__pro-pop" is gone — the polish offer is an
      // inline row under its bullet now, not a full-screen overlay.
    ]
  ) {
    assert(classes.has(c), `${c} not recognised as a fixed inset:0 overlay`);
  }
});

Deno.test("REQ-354 M39: no full-screen backdrop closes on a raw onClick — every one goes through <Backdrop>", async () => {
  assertEquals(await rawBackdropClicks(), []);
});

Deno.test("REQ-354 M39: the New customer modal and the Send chooser use <Backdrop>", async () => {
  const clients = await Deno.readTextFile(
    new URL("islands/ClientsPage.tsx", root),
  );
  assert(
    // REQ-300 (reconciled on demo-fixes): onClose also keeps a dirty draft up
    // (REQ-715: the draft carries the customer's language too)
    /<Backdrop[\s\S]{0,700}setAddOpen\(false\)/.test(clients),
    "ClientsPage add modal not on <Backdrop>",
  );
  const chat = await Deno.readTextFile(new URL("islands/AsstChat.tsx", root));
  assert(
    /<Backdrop\s+class="send-dialog__backdrop"[\s\S]{0,200}setSendDialogOpen\(false\)/
      .test(chat),
    "AsstChat send-dialog backdrop not on <Backdrop>",
  );
});
