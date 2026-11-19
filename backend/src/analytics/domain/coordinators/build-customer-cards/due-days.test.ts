// qa-loop integration (REQ-1066 story, q2-56): "due in N days" counts calendar
// days, so an invoice due 30 days out reads 30 at any hour of the day.
import { assertEquals } from "#std/assert";
import { buildBalanceSub } from "./mod.ts";

for (const hour of ["00:05", "11:59", "12:01", "23:55"]) {
  Deno.test(`REQ-1066 buildBalanceSub: an invoice due in 30 days reads 30 at ${hour} UTC`, () => {
    const now = new Date(`2026-11-19T${hour}:00.000Z`);
    // deno-lint-ignore no-explicit-any
    const inv = {
      id: "i1",
      number: "INV-001",
      status: "sent",
      amount: 8500,
      dueDate: "2026-12-19",
      payments: [],
    } as any;
    const sub = buildBalanceSub(8500, [inv], [], now);
    assertEquals(sub, { kind: "dueIn", ref: "INV-001", days: 30 });
  });
}
