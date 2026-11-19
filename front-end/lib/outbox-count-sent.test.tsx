/**
 * REQ-1078 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the test,
 * then one to fix it and make it green." LOOP-007 cycle 2, issue q2-66
 * [polish/BUG_CONTRADICTION] "Outbox counts a refused text as 'Sent to
 * customers'".
 *
 * REQ-784 lists every message that went OR was meant to go — a refused text
 * (a 555 number) is a row that says "Not texted". The panel heading over the
 * list read "Sent to customers" / "Enviado a clientes" with a counter of
 * rows.length, so 2 sent emails + 1 refused text showed "Sent to customers 3".
 *
 * The rule: the heading never claims more messages were sent than actually
 * went. With [sent email, sent email, not-texted text] it does not say "sent"
 * over 3, and it does show the 2 that went (en + es).
 *
 * The island is mounted live (hooks and the GET /outbox effect run for real,
 * api.get stubbed); the browser proof is e2e/outbox (REQ-1078 story).
 */
import { assert } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { options, render } from "preact";
import { act } from "preact/test-utils";
import { api } from "./api.ts";
import { langSignal } from "./i18n.ts";
import type { OutboxRow } from "./outbox.ts";
import OutboxPage from "../islands/OutboxPage.tsx";

const dict = (lang: "en" | "es") =>
  JSON.parse(
    Deno.readTextFileSync(new URL(`../../lang/${lang}.json`, import.meta.url)),
  ) as Record<string, string>;

/** Rosa Delgado (QA's run): invoice email, receipt email, receipt text refused (843-555-0111). */
const ROWS: OutboxRow[] = [
  {
    id: "o-3",
    createdAt: "2026-11-19T15:09:00.000Z",
    channel: "text",
    status: "not_sent",
    reasonCode: "fictional",
    reason: "that's a reserved test number (555-01XX or area code 555)",
    language: "en",
    kind: "receipt",
    customerName: "Rosa Delgado",
    to: "+18435550111",
    docRef: "INV-002",
    preview: "",
  } as OutboxRow,
  {
    id: "o-2",
    createdAt: "2026-11-19T15:08:00.000Z",
    channel: "email",
    status: "sent",
    language: "en",
    kind: "receipt",
    customerName: "Rosa Delgado",
    to: "rosa@example.com",
    docRef: "INV-002",
    subject: "Payment received — INV-002",
    preview: "Payment received — INV-002",
  } as OutboxRow,
  {
    id: "o-1",
    createdAt: "2026-11-19T15:07:00.000Z",
    channel: "email",
    status: "sent",
    language: "en",
    kind: "invoice",
    customerName: "Rosa Delgado",
    to: "rosa@example.com",
    docRef: "INV-002",
    subject: "Invoice INV-002",
    preview: "Invoice INV-002",
  } as OutboxRow,
];

type Get = typeof api.get;
type VNodeLike = { type: unknown; props?: Record<string, unknown> };

/** Rebuild a precompiled template vnode's HTML: tpl[0] + exprs[0] + tpl[1] … */
function serialize(x: unknown): string {
  if (x === null || x === undefined || typeof x === "boolean") return "";
  if (typeof x === "string" || typeof x === "number") return String(x);
  if (Array.isArray(x)) return x.map(serialize).join("");
  const v = x as VNodeLike;
  const p = v.props ?? {};
  if (Array.isArray(p.tpl)) {
    const tpl = p.tpl as string[];
    const exprs = (p.exprs ?? []) as unknown[];
    return tpl.map((part, i) =>
      part + (i < exprs.length ? serialize(exprs[i]) : "")
    )
      .join("");
  }
  if (typeof v.type === "string") {
    return `<${v.type}>${serialize(p.children)}</${v.type}>`;
  }
  // an unrendered component (e.g. OutboxTable): a marker, not its contents
  return " [component] ";
}

/**
 * Mount OutboxPage with GET /outbox answering ROWS and return the text of the
 * panel title (`.panel__title`: the heading plus its count) of the LATEST
 * render. This config precompiles JSX into SSR templates that draw nothing
 * into a live DOM, so the panel's HTML is rebuilt from the template vnode
 * that carries `panel__title` (its `tpl` parts interleaved with its `exprs`).
 */
async function panelTitle(lang: "en" | "es"): Promise<string> {
  const doc = new DOMParser().parseFromString(
    "<html><body><div id=r></div></body></html>",
    "text/html",
  )!;
  const g = globalThis as unknown as { document?: unknown };
  const prevDoc = g.document;
  const prevGet = api.get;
  const prevLang = langSignal.value;
  const o = options as { vnode?: (v: VNodeLike) => void };
  const prevVnode = o.vnode;
  let last: VNodeLike | null = null;
  o.vnode = (v) => {
    const p = v.props;
    if (
      p && Array.isArray(p.tpl) &&
      (p.tpl as string[]).some((s) => s.includes("panel__title"))
    ) last = v;
    prevVnode?.(v);
  };
  g.document = doc;
  langSignal.value = lang;
  (api as { get: Get }).get = ((path: string) =>
    Promise.resolve(
      path.startsWith("/outbox") ? structuredClone(ROWS) : [],
    )) as Get;
  try {
    const root = doc.getElementById("r") as unknown as Element;
    await act(() => {
      render(<OutboxPage />, root);
    });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
    }
    await act(() => {
      render(null, root);
    });
  } finally {
    o.vnode = prevVnode;
    g.document = prevDoc;
    langSignal.value = prevLang;
    (api as { get: Get }).get = prevGet;
  }
  assert(last, "the outbox panel rendered");
  const html = serialize(last);
  assert(
    html.includes("[component]"),
    `the rows loaded (the table is rendered, not the loading hint): ${html}`,
  );
  const parsed = new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  )!;
  const title = parsed.querySelector(".panel__title");
  assert(title, `the panel has a title: ${html}`);
  return title.textContent.replace(/\s+/g, " ").trim();
}

for (const lang of ["en", "es"] as const) {
  const d = dict(lang);
  Deno.test(
    `REQ-1078 (LOOP-007 q2, q2-66): [sent email, sent email, not-texted text] — the outbox heading never says "${
      d["outbox.listTitle"]
    }" over 3; it shows the 2 that went (${lang})`,
    async () => {
      const title = await panelTitle(lang);
      const sentWord = lang === "en" ? /\bsent\b/i : /\benviad[oa]s?\b/i;
      const numbers = [...title.matchAll(/\d+/g)].map((m) => Number(m[0]));
      // the contradiction QA saw: a "sent" heading whose only count is all 3 rows
      assert(
        !(sentWord.test(title) && numbers.includes(3) && !numbers.includes(2)),
        `the heading counts the refused text as sent: "${title}"`,
      );
      assert(
        numbers.includes(2),
        `the heading shows the 2 messages that actually went: "${title}"`,
      );
    },
  );
}
