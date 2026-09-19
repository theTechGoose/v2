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
