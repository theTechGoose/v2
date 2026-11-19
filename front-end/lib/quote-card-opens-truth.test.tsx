/**
 * REQ-955 — Raphael: "test every single aspect of this application … one Opus
 * agent per issue to do root cause analysis, then one to write the test, then
 * one to fix it and make it green." LOOP-007 cycle 1, issue q1-30
 * [minor/BUG_CONTRADICTION] "Quote card contradicts itself on opens".
 *
 * The card's headline count (`q.opens`, from GET /quotes) says "1 open", but
 * its timeline and its reading come from `realOpens`, which is null until a
 * lazy GET /quotes/:id/opens resolves (and [] for good when it fails). The
 * render did `realOpens ?? []`, so "not loaded yet" read as "zero opens":
 * "No opens recorded yet." and "Sent, but no opens yet…" next to "1 open".
 *
 * The rule: while the card says it was opened (q.opens > 0), no part of it
 * says there were no opens — not before the history loads, not when the load
 * fails, and not in the SSR'd (unflipped, always-in-the-DOM) back face.
 * The browser proof is e2e/quote-card-opens-truth.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { options, render } from "preact";
import { act } from "preact/test-utils";
import { renderToString } from "preact-render-to-string";
import { api } from "./api.ts";
import { type OpenEvent, type Quote, readingFor } from "./quotes-seed.ts";
import QuoteCard from "../islands/QuoteCard.tsx";

const en = JSON.parse(
  Deno.readTextFileSync(new URL("../../lang/en.json", import.meta.url)),
) as Record<string, string>;
const es = JSON.parse(
  Deno.readTextFileSync(new URL("../../lang/es.json", import.meta.url)),
) as Record<string, string>;

/** Every "there were no opens" string the card can print, both languages. */
const NO_OPENS = [en, es].flatMap((d) => [
  d["quoteCard.back.noOpens"],
  d["quotesSeed.reading.noOpens.text"],
  d["quotesSeed.reading.noOpensText.text"],
]);

const OPENED: Quote = {
  id: "q-955",
  title: "Bathroom remodel",
  client: "Jose Ramirez",
  initials: "JR",
  customerId: "c-955",
  stage: "opened",
  value: 4200,
  daysIn: 1,
  opens: 1,
  sentDays: 1,
  band: ["#000", "#111"],
  shadow: "none",
  channel: "email",
  number: "Q-002",
  version: 1,
};

function saysNoOpens(text: string): string | undefined {
  return NO_OPENS.find((s) => text.includes(s));
}

Deno.test("REQ-955 (LOOP-007 q1-30): readingFor never says 'no opens' for a quote that was opened, before its history loads ([])", () => {
  for (const lang of ["en", "es"] as const) {
    for (const q of [OPENED, { ...OPENED, channel: "sms" as const }]) {
      const r = readingFor(q, [], lang);
      const all = `${r.text} ${r.em ?? ""} ${r.tail ?? ""}`;
      assertEquals(
        saysNoOpens(all),
        undefined,
        `${lang}/${q.channel}: q.opens=1 but the reading is "${all}"`,
      );
    }
  }
});

Deno.test("REQ-955 (LOOP-007 q1-30): readingFor takes a not-loaded (null) history and reads the card's own count", () => {
  for (const lang of ["en", "es"] as const) {
    let all = "";
    try {
      const r = readingFor(
        OPENED,
        null as unknown as OpenEvent[],
        lang,
      );
      all = `${r.text} ${r.em ?? ""} ${r.tail ?? ""}`;
    } catch (e) {
      throw new Error(
        `${lang}: readingFor(q, null) threw — not-loaded must be a state: ${e}`,
      );
    }
    assertEquals(saysNoOpens(all), undefined, `${lang}: "${all}"`);
  }
  // a quote with no opens still gets the honest copy (P-15)
  const none = readingFor({ ...OPENED, stage: "sent", opens: 0 }, [], "en");
  assertEquals(none.text, en["quotesSeed.reading.noOpens.text"]);
});

Deno.test("REQ-955 (LOOP-007 q1-30): the SSR'd card (history not loaded) does not say '1 open' and 'no opens' at once", () => {
  const html = renderToString(<QuoteCard q={OPENED} idx={1} lang="en" />);
  const text = new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  )!.body.textContent ?? "";
  assert(text.includes("1×"), `front shows the count: ${text}`);
  assert(text.includes("open · Jose"), `back head shows the count: ${text}`);
  assertEquals(
    saysNoOpens(text),
    undefined,
    `the same card says it was opened AND not: ${text}`,
  );
});

type Get = typeof api.get;
type VNodeLike = { type: unknown; props?: Record<string, unknown> };

/** Mount the island live (flipped), with api.get stubbed, and return the text
 *  of its LATEST render. This config precompiles JSX into SSR templates, which
 *  draw nothing into a live DOM — so the text is read off the template vnodes
 *  each render creates (their static `tpl` parts and string `exprs`), and a
 *  render ends when the QuoteCard vnode is diffed. Hooks and effects run for
 *  real: the lazy GET /quotes/:id/opens fires and its result lands in state. */
async function mountFlipped(get: Get): Promise<string> {
  const doc = new DOMParser().parseFromString(
    "<html><body><div id=r></div></body></html>",
    "text/html",
  )!;
  const g = globalThis as unknown as { document?: unknown };
  const prevDoc = g.document;
  const prevGet = api.get;
  const o = options as {
    vnode?: (v: VNodeLike) => void;
    diffed?: (v: VNodeLike) => void;
  };
  const prevVnode = o.vnode;
  const prevDiffed = o.diffed;
  let buf: string[] = [];
  let last = "";
  o.vnode = (v) => {
    const p = v.props;
    if (p && Array.isArray(p.tpl)) buf.push(...(p.tpl as string[]));
    if (p && Array.isArray(p.exprs)) {
      for (const e of p.exprs as unknown[]) {
        if (typeof e === "string" || typeof e === "number") buf.push(String(e));
      }
    }
    prevVnode?.(v);
  };
  o.diffed = (v) => {
    if (v.type === QuoteCard) {
      last = buf.join(" ");
      buf = [];
    }
    prevDiffed?.(v);
  };
  g.document = doc;
  (api as { get: Get }).get = get;
  try {
    const root = doc.getElementById("r") as unknown as Element;
    await act(() => {
      render(<QuoteCard q={OPENED} idx={1} lang="en" flipOnMount />, root);
    });
    // let the fetch settle into state and the card re-render
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
    }
    await act(() => {
      render(null, root);
    });
    return last;
  } finally {
    o.vnode = prevVnode;
    o.diffed = prevDiffed;
    g.document = prevDoc;
    (api as { get: Get }).get = prevGet;
  }
}

Deno.test("REQ-955 (LOOP-007 q1-30): harness check — once the history loads, the flipped card shows it and no 'no opens' copy", async () => {
  const text = await mountFlipped(
    (() =>
      Promise.resolve({
        opens: [{
          at: "2026-11-17T15:42:00.000Z",
          atRel: "1d ago",
          device: "mobile",
        }],
      })) as unknown as Get,
  );
  assert(text.includes("Q-002"), `the card rendered: ${text}`);
  assert(text.includes(en["quoteCard.device.mobile"]), `timeline row: ${text}`);
  assertEquals(saysNoOpens(text), undefined, `loaded: ${text}`);
});

Deno.test("REQ-955 (LOOP-007 q1-30): flipped, while GET /quotes/:id/opens is still in flight, the card never says 'no opens' under '1 open'", async () => {
  let asked = "";
  const text = await mountFlipped(
    ((path: string) => {
      asked = path;
      return new Promise(() => {}); // never resolves
    }) as Get,
  );
  assertEquals(asked, "/quotes/q-955/opens", "the card asked for its history");
  assert(text.includes("Q-002"), `the card rendered: ${text}`);
  assertEquals(saysNoOpens(text), undefined, `card while loading: ${text}`);
});

Deno.test("REQ-955 (LOOP-007 q1-30): flipped, when GET /quotes/:id/opens fails, the card never says 'no opens' under '1 open'", async () => {
  const text = await mountFlipped(
    (() => Promise.reject(new Error("500"))) as Get,
  );
  assert(text.includes("Q-002"), `the card rendered: ${text}`);
  assertEquals(
    saysNoOpens(text),
    undefined,
    `card after a failed load: ${text}`,
  );
});
