/**
 * REQ-472 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3, issue p8-pair5-c: "Customer link shown as a raw
 * ID" — CustomerLinkRow printed `/q/e302df3d-…` (the quote's uuid) in its
 * <code>. The row names the document ("Q-001") when the number is known,
 * otherwise a visually truncated path ("/q/e302…"); Copy and Open still use
 * the full link.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { customerLinkDisplay } from "./customer-link.ts";
import { CustomerLinkRow } from "../components/CustomerLinkRow.tsx";

const ID = "e302df3d-5b1c-4a8e-9f00-1234567890ab";

function rowDoc(quoteNumber?: string) {
  const html = renderToString(
    <CustomerLinkRow
      quoteId={ID}
      quoteNumber={quoteNumber}
      lang="en"
      onCopy={() => {}}
    />,
  );
  return new DOMParser().parseFromString(`<div>${html}</div>`, "text/html")!;
}

Deno.test("REQ-472 customerLinkDisplay: the document number when known", () => {
  assertEquals(customerLinkDisplay(ID, "Q-001"), "Q-001");
  assertEquals(customerLinkDisplay(ID, "  Q-007 "), "Q-007");
});

Deno.test("REQ-472 customerLinkDisplay: no number → a truncated /q/ path, never the whole uuid", () => {
  assertEquals(customerLinkDisplay(ID), "/q/e302…");
  assertEquals(customerLinkDisplay(ID, ""), "/q/e302…");
  assertEquals(customerLinkDisplay(ID, null), "/q/e302…");
  // an id already short enough is shown whole
  assertEquals(customerLinkDisplay("abc"), "/q/abc");
});

Deno.test("REQ-472 CustomerLinkRow shows the document number, not the raw id; Open keeps the full link", () => {
  const doc = rowDoc("Q-001");
  const shown = doc.querySelector(".customer-link__path")!;
  assertEquals(shown.textContent.trim(), "Q-001");
  assert(!doc.body.textContent.includes(ID), "the raw uuid is not printed");
  const open = doc.querySelector('[data-cy="customer-link-open"]')!;
  assertEquals(open.getAttribute("href"), `/q/${ID}`);
  assertEquals(shown.getAttribute("title"), `/q/${ID}`);
});

Deno.test("REQ-472 CustomerLinkRow without a number shows /q/e302… and still opens the full link", () => {
  const doc = rowDoc();
  const shown = doc.querySelector(".customer-link__path")!;
  assertEquals(shown.textContent.trim(), "/q/e302…");
  assert(!doc.body.textContent.includes(ID), "the raw uuid is not printed");
  assertEquals(
    doc.querySelector('[data-cy="customer-link-open"]')!.getAttribute("href"),
    `/q/${ID}`,
  );
});

Deno.test("REQ-472 both AsstChat callers pass the quote's number to the row", async () => {
  const chat = await Deno.readTextFile(
    new URL("../islands/AsstChat.tsx", import.meta.url),
  );
  const calls = chat.split("<CustomerLinkRow").slice(1).map((s) =>
    s.slice(0, s.indexOf("/>"))
  );
  assertEquals(calls.length, 2);
  for (const c of calls) assert(/quoteNumber=\{/.test(c), c);
});
