/**
 * REQ-670 (demo-loop cycle 5, p7 "Assistant replies never stream" — and the
 * backlog's c1-nc-6, c2-nc-stream, c4-nc-no-streaming): the assistant's
 * pending reply bubble, front-end/components/PendingReplyBubble.tsx.
 *
 *   - It shows the reply so far, else what the turn is doing in words beside
 *     the dots ("Assistant is thinking…", "Pricing the job…") — en and es.
 *   - It reads the turn's signal itself: a streamed piece re-renders the
 *     bubble, never the chat island around it. Held in the island's own state
 *     (the first cut), every piece re-rendered all of AsstChat — measured on a
 *     loaded host at 60–370 ms a render, tens of pieces a reply.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { h, options, render, type VNode } from "preact";
import { renderToString } from "preact-render-to-string";
import { type Signal, signal, useSignal } from "@preact/signals";
import { PendingReplyBubble } from "../components/PendingReplyBubble.tsx";
import {
  type ChatStreamEvent,
  NO_REPLY_YET,
  type PendingReply,
  pendingReply,
} from "./chat-stream.ts";

function parse(html: string) {
  return new DOMParser().parseFromString(`<div>${html}</div>`, "text/html")!;
}

Deno.test("REQ-670 PendingReplyBubble: no prose yet → the typing dots and, in words, what the turn is doing (en and es)", () => {
  const cases: Array<[PendingReply, "en" | "es", string]> = [
    [NO_REPLY_YET, "en", "Assistant is thinking…"],
    [NO_REPLY_YET, "es", "El asistente está pensando…"],
    [{ text: "", stage: "pricing" }, "en", "Pricing the job…"],
    [{ text: "", stage: "drafting" }, "es", "Preparando la cotización…"],
    [{ text: "", stage: "saving" }, "en", "Saving…"],
  ];
  for (const [state, lang, label] of cases) {
    const doc = parse(
      renderToString(
        <PendingReplyBubble reply={signal(state)} lang={lang} />,
      ),
    );
    assertEquals(
      doc.querySelector("[data-cy=msg-typing-label]")?.textContent?.trim(),
      label,
    );
    assertEquals(doc.querySelectorAll(".typing-dot").length, 3);
    assertEquals(doc.querySelector("[data-cy=msg-streaming]"), null);
  }
});

Deno.test("REQ-670 PendingReplyBubble: prose → the reply so far in the bubble, the label gone", () => {
  const doc = parse(
    renderToString(
      <PendingReplyBubble
        reply={signal({ text: "Most decks run", stage: null })}
        lang="en"
      />,
    ),
  );
  const bubble = doc.querySelector("[data-cy=msg-streaming]");
  assertEquals(bubble?.textContent, "Most decks run");
  assert(bubble?.classList.contains("msg__bubble"));
  assertEquals(doc.querySelector("[data-cy=msg-typing-label]"), null);
  assertEquals(doc.querySelector(".msg")?.getAttribute("aria-busy"), "true");
});

Deno.test("REQ-670 PendingReplyBubble: each streamed piece re-renders the bubble only — never the chat around it", async () => {
  // A live Preact tree in deno-dom. The chat is built with h(): this config
  // precompiles JSX into SSR templates, which only render to a string — so
  // what the bubble shows is read with renderToString, and the live tree
  // counts renders.
  const dom = new DOMParser().parseFromString(
    "<div id=root></div>",
    "text/html",
  )!;
  const g = globalThis as { document?: unknown };
  const before = g.document;
  g.document = dom;
  const o = options as { diffed?: (vnode: VNode) => void };
  const diffed = o.diffed;
  let chatRenders = 0;
  let bubbleRenders = 0;
  let reading = false; // renderToString runs the same hook — not a live render
  o.diffed = (vnode) => {
    if (!reading && vnode.type === PendingReplyBubble) bubbleRenders++;
    diffed?.(vnode);
  };
  const root = dom.getElementById("root")! as unknown as Element;
  try {
    let live: Signal<PendingReply> | null = null;
    // the island's shape: the turn's signal held by the chat, the bubble fed it
    const Chat = () => {
      chatRenders++;
      const reply = useSignal<PendingReply>(NO_REPLY_YET);
      live = reply;
      return h(
        "div",
        { class: "chat__scroll" },
        h(PendingReplyBubble, { reply, lang: "en" }),
      );
    };
    render(h(Chat, null), root);
    const settle = () => new Promise((r) => setTimeout(r, 0));
    await settle();
    assertEquals([chatRenders, bubbleRenders], [1, 1]);

    const shows = () => {
      reading = true;
      const html = renderToString(
        <PendingReplyBubble reply={live!} lang="en" />,
      );
      reading = false;
      const doc = parse(html);
      return (doc.querySelector("[data-cy=msg-streaming]") ??
        doc.querySelector("[data-cy=msg-typing-label]"))?.textContent?.trim();
    };
    const events: ChatStreamEvent[] = [
      { type: "progress", stage: "pricing" },
      { type: "delta", text: "Most decks" },
      { type: "delta", text: " run $25" },
      { type: "delta", text: " to $35 a square foot." },
    ];
    const seen: Array<string | undefined> = [];
    for (const event of events) {
      live!.value = pendingReply(live!.peek(), event);
      await settle();
      seen.push(shows());
    }
    assertEquals(seen, [
      "Pricing the job…",
      "Most decks",
      "Most decks run $25",
      "Most decks run $25 to $35 a square foot.",
    ]);
    assertEquals(bubbleRenders, 1 + events.length, "the bubble, once a piece");
    assertEquals(chatRenders, 1, "the chat never re-rendered for a piece");

    live!.value = NO_REPLY_YET;
    await settle();
    assertEquals(shows(), "Assistant is thinking…");
    assertEquals(chatRenders, 1);
  } finally {
    render(null, root);
    o.diffed = diffed;
    g.document = before;
  }
});
