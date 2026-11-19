/**
 * REQ-1079 (LOOP-007 cycle 2, q2-68) — Raphael: "test every single aspect of
 * this application … one Opus agent per issue to do root cause analysis, then
 * one to write the test, then one to fix it and make it green."
 *
 * q2-68: the signed copy shares the quote PDF's English-only naming
 * ("Agreement-Q-001.pdf" on a Spanish signed email, seen in QA2). It is named
 * in the send language: "Acuerdo-Q-001.pdf" in Spanish, "Agreement-Q-001.pdf"
 * in English.
 */
import { assertEquals } from "#std/assert";
import type { Lang } from "@core/i18n/mod.ts";
import { agreementFileName } from "./mod.ts";

const named = agreementFileName as (
  quote: { id: string; number?: string },
  lang: Lang,
) => string;

Deno.test("REQ-1079 q2-68 agreementFileName: a Spanish send names the signed copy 'Acuerdo-Q-001.pdf'", () => {
  assertEquals(
    named({ id: "q-1", number: "Q-001" }, "es"),
    "Acuerdo-Q-001.pdf",
  );
});

Deno.test("REQ-1079 q2-68 agreementFileName: an English send keeps 'Agreement-Q-001.pdf'", () => {
  assertEquals(
    named({ id: "q-1", number: "Q-001" }, "en"),
    "Agreement-Q-001.pdf",
  );
});
