import { assertEquals } from "#std/assert";
import { localizeTermValue as quotePdf } from "./mod.ts";
import { localizeTermValue as invoicePdf } from "@paperwork/domain/coordinators/render-invoice-pdf/mod.ts";

// REQ-009 — NW-24 (p23): term values are PERSISTED in English and localized
// by exact string match. New quotes save "Job completed"; old quotes still
// carry "Job Completed" — both must print "Trabajo terminado" on the PDFs.
for (const [name, fn] of [["quote PDF", quotePdf], ["invoice PDF", invoicePdf]] as const) {
  Deno.test(`REQ-009 NW-24 ${name}: 'Job completed' (new) and 'Job Completed' (old) both localize to 'Trabajo terminado'`, () => {
    assertEquals(fn("Job completed", "es"), "Trabajo terminado");
    assertEquals(fn("Job Completed", "es"), "Trabajo terminado");
    assertEquals(fn("Job completed", "en"), "Job completed");
  });
  Deno.test(`REQ-009 NW-23 ${name}: 'Next month' and 'Next Month' both localize to 'El próximo mes'`, () => {
    assertEquals(fn("Next month", "es"), "El próximo mes");
    assertEquals(fn("Next Month", "es"), "El próximo mes");
  });
}

// REQ-015 (p76-77): warranty presets now persist "1 year" / "2 years" — the
// Spanish PDFs must localize the year words like they do months/weeks/days.
for (const [name, fn] of [["quote PDF", quotePdf], ["invoice PDF", invoicePdf]] as const) {
  Deno.test(`REQ-015 ${name}: '1 year' / '2 years' localize to '1 año' / '2 años'`, () => {
    assertEquals(fn("1 year", "es"), "1 año");
    assertEquals(fn("2 years", "es"), "2 años");
    assertEquals(fn("2 years", "en"), "2 years");
  });
}
