import { assert, assertEquals } from "#std/assert";
import { namesOptionRole } from "./role-words.ts";

/**
 * REQ-667 (demo-loop cycle 5, m49): the concise option's summary came back
 * as "Concise scope of work" / "Alcance de trabajo conciso" and became the
 * line description on the customer's agreement. A summary or jobName that
 * names the option's internal role is not a description of the job.
 */

Deno.test("REQ-667 (m49) role labels are recognised in en and es", () => {
  for (
    const s of [
      "Concise scope of work",
      "Alcance de trabajo conciso",
      "Standard scope",
      "Detailed Scope Of Work",
      "Alcance detallado",
      "Versión estándar",
      "Scope of work",
      "Alcance de trabajo",
      "Opción concisa",
    ]
  ) {
    assert(namesOptionRole(s), `not recognised: ${s}`);
  }
});

Deno.test("REQ-667 (m49) real job descriptions are left alone", () => {
  for (
    const s of [
      "Kitchen Remodel",
      "Remodelación de cocina",
      "Install 22 lf of new cabinets",
      "Interior paint, 3 bedrooms",
      "Alcance ampliado",
      "Bathroom Renovation · Short version",
    ]
  ) {
    assertEquals(namesOptionRole(s), false, s);
  }
});
