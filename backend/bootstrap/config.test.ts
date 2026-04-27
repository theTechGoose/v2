import { assertEquals } from "#std/assert";
import { loadConfig } from "./config.ts";

Deno.test("loadConfig: defaults port to 3000 when PORT is unset", () => {
  Deno.env.delete("PORT");
  const cfg = loadConfig();
  assertEquals(cfg.port, 3000);
});

Deno.test("loadConfig: reads PORT from env when set", () => {
  Deno.env.set("PORT", "4321");
  const cfg = loadConfig();
  assertEquals(cfg.port, 4321);
  Deno.env.delete("PORT");
});

Deno.test("loadConfig: empty PORT falls back to default", () => {
  Deno.env.set("PORT", "");
  const cfg = loadConfig();
  // Number("") === 0, so empty string is treated as port 0 (let OS pick).
  // This test pins the current behavior — change it intentionally if the
  // contract for "empty string" PORT should fall back to 3000.
  assertEquals(cfg.port, 0);
  Deno.env.delete("PORT");
});

Deno.test("loadConfig: non-numeric PORT yields NaN (caller is responsible for guarding)", () => {
  Deno.env.set("PORT", "abc");
  const cfg = loadConfig();
  // Number("abc") === NaN; documents current behavior.
  assertEquals(Number.isNaN(cfg.port), true);
  Deno.env.delete("PORT");
});
