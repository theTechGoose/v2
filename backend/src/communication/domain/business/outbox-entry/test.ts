/**
 * REQ-784 — Raphael: "And yes to a sent message outbox." Demo-loop cycle
 * dv1, issue d12: the outbox lists every email and text that went to a
 * customer with its subject or first line, and keeps the full content as
 * sent. These are the pure pieces: the list line, and the paging that lets a
 * whole email body sit in Deno KV (a value is capped at 64 KiB).
 */
import { assert, assertEquals } from "#std/assert";
import {
  customerLabel,
  joinBody,
  OUTBOX_PAGE_CHARS,
  outboxPreview,
  PREVIEW_MAX,
  splitBody,
} from "./mod.ts";

Deno.test("REQ-784 d12: an email's outbox line is its subject", () => {
  assertEquals(
    outboxPreview({
      channel: "email",
      subject: "  Cotización Q-001 de A2Z Landscape — Cerca  ",
      body: "<html><body>Hola María</body></html>",
    }),
    "Cotización Q-001 de A2Z Landscape — Cerca",
  );
});

Deno.test("REQ-784 d12: a text's outbox line is its first non-empty line", () => {
  assertEquals(
    outboxPreview({
      channel: "text",
      body:
        "\n  Hola María, soy Luis de A2Z Landscape.\n\nTu cotización está lista: https://x.test/s/abc",
    }),
    "Hola María, soy Luis de A2Z Landscape.",
  );
});

Deno.test("REQ-784 d12: a long first line is cut at the cap with an ellipsis", () => {
  const line = "word ".repeat(80).trim();
  const out = outboxPreview({ channel: "text", body: line });
  assert(out.length <= PREVIEW_MAX, `${out.length} > ${PREVIEW_MAX}`);
  assert(out.endsWith("…"), out);
  assert(line.startsWith(out.slice(0, -1).trimEnd()), out);
});

Deno.test("REQ-784 d12: an email with no subject falls back to its first line of text, never the raw HTML", () => {
  const out = outboxPreview({
    channel: "email",
    body:
      "<!doctype html><html><body><div>Hi Tom,</div><p>Your quote</p></body></html>",
  });
  assertEquals(out, "Hi Tom,");
});

Deno.test("REQ-784 d12: a body splits into KV-sized pages and joins back exactly — accents and emoji included", () => {
  const body = ("Cotización ✓ 🎉 — ñandú ".repeat(4000)) + "fin";
  const pages = splitBody(body);
  assert(pages.length > 1, "a long body takes more than one page");
  for (const p of pages) {
    assert(p.length <= OUTBOX_PAGE_CHARS, `page of ${p.length} chars`);
    // V8 serializes a two-byte string at 2 bytes per UTF-16 unit — a page
    // must stay under KV's 64 KiB value cap even then.
    assert(p.length * 2 < 64 * 1024, "a page fits a KV value");
  }
  assertEquals(joinBody(pages), body);
  // no surrogate pair is cut in half between pages
  for (const p of pages) {
    assert(!/[\uD800-\uDBFF]$/.test(p), "a page never ends mid-emoji");
  }
  assertEquals(splitBody(""), []);
  assertEquals(joinBody([]), "");
});

Deno.test("REQ-784 d12: the customer is named as the document names them — the person, else the business", () => {
  assertEquals(
    customerLabel({ name: " María López ", businessName: "ML Co" }),
    "María López",
  );
  assertEquals(
    customerLabel({ name: "  ", businessName: "Rivera Roofing" }),
    "Rivera Roofing",
  );
  assertEquals(customerLabel(undefined), undefined);
});
