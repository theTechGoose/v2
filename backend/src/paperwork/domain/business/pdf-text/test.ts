import { assertEquals } from "#std/assert";
import { winAnsiSafe, winAnsiSafeDeep } from "./mod.ts";

// REQ-161 — "download pdf gives 500." (WinAnsi cannot encode "→")
Deno.test("REQ-161 winAnsiSafe: every string the PDF fonts draw is WinAnsi-encodable — arrows become dashes, Latin-1 and the smart punctuation stay, anything else is dropped", () => {
  assertEquals(
    winAnsiSafe("Maintenance 2026-10-01 → 2026-10-31"),
    "Maintenance 2026-10-01 – 2026-10-31",
  );
  assertEquals(
    winAnsiSafe("Oct 2 — Lawn — 725 Frederick Rd"),
    "Oct 2 — Lawn — 725 Frederick Rd",
  );
  assertEquals(
    winAnsiSafe("Mantenimiento · día 1 — señor Peña, €5 “ok” …"),
    "Mantenimiento · día 1 — señor Peña, €5 “ok” …",
  );
  assertEquals(winAnsiSafe("Lawn ✅ done 🌱"), "Lawn  done ");
  assertEquals(winAnsiSafe("Łódź → Kraków"), "Lódz – Kraków");
  assertEquals(winAnsiSafe("line 1\nline 2\tx"), "line 1\nline 2\tx");
});

Deno.test("REQ-161 winAnsiSafeDeep: maps every string inside a document's data, leaving numbers, booleans and shape alone", () => {
  const inv = {
    jobName: "A → B",
    amount: 100,
    draft: true,
    lineItems: [{ description: "x → y", price: 1 }],
    nested: { note: null },
  };
  assertEquals(winAnsiSafeDeep(inv), {
    jobName: "A – B",
    amount: 100,
    draft: true,
    lineItems: [{ description: "x – y", price: 1 }],
    nested: { note: null },
  });
  assertEquals(winAnsiSafeDeep(undefined), undefined);
  assertEquals(winAnsiSafeDeep(["→"]), ["–"]);
});
