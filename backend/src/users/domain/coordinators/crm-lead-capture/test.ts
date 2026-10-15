// REQ-073 — the lead-capture outbox's boot work never takes the isolate down: a sweep that
// cannot read its outbox resolves with the failure named, and a cron whose registration rejects
// is logged, not left as an unhandled rejection. Pure: stub outbox, stub CRM, injected cron.
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import type { CrmCaptureOutbox } from "@users/domain/data/crm-capture-outbox/mod.ts";
import type { CrmCustomerSync } from "@users/domain/coordinators/crm-customer-sync/mod.ts";
import { CrmLeadCapture } from "./mod.ts";

function capture(method: "warn" | "error") {
  const lines: string[] = [];
  const original = console[method];
  console[method] = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  return { lines, restore: () => (console[method] = original) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

Deno.test("REQ-073 drain — an outbox that cannot be read resolves with the failure named and logged; it never rejects", async () => {
  const outbox = { list: () => Promise.reject(new Error("kv closed")) } as unknown as CrmCaptureOutbox;
  const crm = { capture: () => Promise.resolve({ customerId: "never" }) } as unknown as CrmCustomerSync;
  const logged = capture("error");
  try {
    const result = await new CrmLeadCapture(outbox, crm).drain();
    assertEquals(result, { landed: 0, deferred: 0, waiting: 0, failed: "kv closed" });
    assertEquals(logged.lines.length, 1);
    assertStringIncludes(logged.lines[0], "kv closed");
  } finally {
    logged.restore();
  }
});

Deno.test("REQ-073 registerSweep — a cron whose registration rejects is logged, never an unhandled rejection; one that throws, or no cron at all, is false and logged", async () => {
  const outbox = { list: () => Promise.resolve([]) } as unknown as CrmCaptureOutbox;
  const crm = {} as CrmCustomerSync;
  const leads = new CrmLeadCapture(outbox, crm);
  const logged = capture("warn");
  try {
    const names: string[] = [];
    const rejects = (name: string) => {
      names.push(name);
      return Promise.reject(new Error("crons are off for this app"));
    };
    assert(leads.registerSweep(rejects), "registered — the platform's answer comes later");
    await tick();
    assertEquals(names, ["crm-lead-capture sweep"]);
    assertStringIncludes(logged.lines.at(-1) ?? "", "crons are off for this app");

    const throws = () => {
      throw new Error("Deno.cron is not allowed here");
    };
    assertEquals(leads.registerSweep(throws), false);
    assertStringIncludes(logged.lines.at(-1) ?? "", "Deno.cron is not allowed here");

    assertEquals(leads.registerSweep(undefined), false, "no Deno.cron: logins and boots still sweep");
    assertStringIncludes(logged.lines.at(-1) ?? "", "no minute sweep");
  } finally {
    logged.restore();
  }
});
