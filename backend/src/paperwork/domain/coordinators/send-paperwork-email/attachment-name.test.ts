/**
 * REQ-1079 (LOOP-007 cycle 2, q2-68) — Raphael: "test every single aspect of
 * this application … one Opus agent per issue to do root cause analysis, then
 * one to write the test, then one to fix it and make it green."
 *
 * q2-68 "Quote PDF attached to a Spanish email is named in English": the
 * Spanish "Cotización Q-001" email carried "Quote-Q-001.pdf", while the
 * receipt in the same thread is "Recibo-INV-001.pdf". The quote attachment is
 * named in the send language: "Cotizacion-Q-001.pdf" in Spanish (no accent,
 * filename-safe), "Quote-Q-001.pdf" in English.
 */
import { assertEquals } from "#std/assert";
import type { Lang } from "@core/i18n/mod.ts";
import { quoteFileName } from "./mod.ts";

// Called through the lang-aware signature the fix gives it; today the extra
// argument is ignored at runtime, which is the bug.
const named = quoteFileName as (
  quote: { id: string; number?: string },
  lang: Lang,
) => string;

Deno.test("REQ-1079 q2-68 quoteFileName: a Spanish send names the quote PDF 'Cotizacion-Q-001.pdf'", () => {
  assertEquals(
    named({ id: "q-1", number: "Q-001" }, "es"),
    "Cotizacion-Q-001.pdf",
  );
});

Deno.test("REQ-1079 q2-68 quoteFileName: an English send keeps 'Quote-Q-001.pdf'", () => {
  assertEquals(named({ id: "q-1", number: "Q-001" }, "en"), "Quote-Q-001.pdf");
});
