import { assertEquals } from "#std/assert";
import { derivePreview, deriveTitleFromFirstUserMessage } from "./mod.ts";

Deno.test("deriveTitleFromFirstUserMessage: short message returned verbatim", () => {
  assertEquals(deriveTitleFromFirstUserMessage("Garage epoxy floor"), "Garage epoxy floor");
});

Deno.test("deriveTitleFromFirstUserMessage: long message truncated with ellipsis", () => {
  const input = "Need a quote for a 3-car garage epoxy floor with diamond grind, polyaspartic 3-coat system, and decorative flakes — about 720 sqft total";
  const title = deriveTitleFromFirstUserMessage(input);
  assertEquals(title.length, 60);
  assertEquals(title.endsWith("…"), true);
});

Deno.test("deriveTitleFromFirstUserMessage: collapses internal whitespace", () => {
  assertEquals(
    deriveTitleFromFirstUserMessage("Need   quote\nfor\tkitchen   remodel"),
    "Need quote for kitchen remodel",
  );
});

Deno.test("deriveTitleFromFirstUserMessage: empty input → 'New conversation'", () => {
  assertEquals(deriveTitleFromFirstUserMessage(""), "New conversation");
  assertEquals(deriveTitleFromFirstUserMessage("   \n  "), "New conversation");
});

Deno.test("derivePreview: longer cap than title (90 chars)", () => {
  const long = "a".repeat(120);
  const out = derivePreview(long);
  assertEquals(out.length, 90);
  assertEquals(out.endsWith("…"), true);
});

Deno.test("derivePreview: empty input → empty string", () => {
  assertEquals(derivePreview(""), "");
});

Deno.test("derivePreview: collapses whitespace", () => {
  assertEquals(derivePreview("hello\n\nworld"), "hello world");
});

// REQ-447 (demo-loop cycle 3, m14): once a quote names the job, the thread is
// titled by the quote's jobName — one name for the header, the list and the
// documents.
Deno.test("REQ-447 m14 titleFromJobName: the job name is the title, trimmed, single-line and capped", async () => {
  const { titleFromJobName } = await import("./mod.ts");
  assertEquals(titleFromJobName("  Faucet  Replacement "), "Faucet Replacement");
  assertEquals(titleFromJobName(undefined), undefined);
  assertEquals(titleFromJobName("   "), undefined);
  assertEquals(titleFromJobName("x".repeat(80))!.length, 60);
});
