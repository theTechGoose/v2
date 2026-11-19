/**
 * REQ-1135 (LOOP-007 cycle 3, q3-60) — the void's cancellation notice: its
 * words (EN / ES, nothing due, the invoice named, no reason or voider), the
 * box's default, and which channels it goes out on.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { composeCancelledCopy } from "./mod.ts";
import {
  voidNoticeChannels,
  voidNoticeDefault,
} from "#documents/void-notice.ts";

const inv = {
  id: "i1",
  number: "INV-003",
  voidReason: "Owner typo on the total",
  voidedBy: { name: "Alexander Jerez" },
} as unknown as { id: string; number: string };

Deno.test("REQ-1135: EN notice says cancelled, nothing is due, names the invoice and links /i", () => {
  const c = composeCancelledCopy({
    lang: "en",
    businessName: "A2Z Landscape LLC",
    invoice: inv,
    customerFirst: "Rosa",
  });
  assertStringIncludes(c.emailSubject, "Cancelled");
  assertStringIncludes(c.emailSubject, "INV-003");
  const html = c.emailHtml("https://x.test/s/abc");
  assertStringIncludes(html, "A2Z Landscape LLC cancelled invoice INV-003");
  assertStringIncludes(html, "Nothing is due");
  assertStringIncludes(html, "Hi Rosa,");
  assertStringIncludes(html, "https://x.test/s/abc");
  assertEquals(
    c.smsBody("https://x.test/s/abc"),
    "A2Z Landscape LLC cancelled invoice INV-003. Nothing is due — please don't pay it. https://x.test/s/abc",
  );
});

Deno.test("REQ-1135: ES notice is Spanish", () => {
  const c = composeCancelledCopy({
    lang: "es",
    businessName: "A2Z",
    invoice: inv,
    customerFirst: "Rosa",
  });
  assertStringIncludes(c.emailSubject, "Cancelada");
  assertStringIncludes(c.emailHtml(""), "No debe nada");
  assertStringIncludes(c.emailHtml(""), 'lang="es"');
  assertStringIncludes(c.smsBody(""), "canceló la factura INV-003");
});

Deno.test("REQ-1135 / REQ-627: the notice never carries the void reason or who voided it", () => {
  for (const lang of ["en", "es"] as const) {
    const c = composeCancelledCopy({
      lang,
      businessName: "A2Z",
      invoice: inv,
    });
    const all = `${c.emailSubject}${c.emailHtml("u")}${c.smsBody("u")}`;
    assert(!all.includes("Owner typo"), "no reason");
    assert(!all.includes("Alexander"), "no voider");
  }
});

Deno.test("REQ-1135: void & duplicate says a corrected invoice follows", () => {
  const c = composeCancelledCopy({
    lang: "en",
    businessName: "A2Z",
    invoice: inv,
    corrected: true,
  });
  assertStringIncludes(c.smsBody(""), "A corrected invoice will follow.");
});

Deno.test("REQ-1135: the box is checked only for a sent invoice she can be reached on", () => {
  assert(voidNoticeDefault({ sentAt: "2026-11-01" }, { email: "r@x.com" }));
  assert(
    voidNoticeDefault({ sentAt: "2026-11-01" }, { textPhone: "+18435550101" }),
  );
  assert(!voidNoticeDefault({}, { email: "r@x.com" }), "never sent");
  assert(!voidNoticeDefault({ sentAt: "2026-11-01" }, {}), "no contact");
});

Deno.test("REQ-1135: the notice goes the way the invoice went", () => {
  const both = { email: "r@x.com", phone: "+18435550101" };
  assertEquals(voidNoticeChannels(["email"], both), ["email"]);
  assertEquals(voidNoticeChannels(["text"], both), ["text"]);
  assertEquals(voidNoticeChannels(["email", "text"], both), ["email", "text"]);
  // paper / unknown → every contact she has
  assertEquals(voidNoticeChannels([], both), ["email", "text"]);
  // went by text, but the phone is gone → the email she has
  assertEquals(voidNoticeChannels(["text"], { email: "r@x.com" }), ["email"]);
  assertEquals(voidNoticeChannels(["email"], {}), []);
});
