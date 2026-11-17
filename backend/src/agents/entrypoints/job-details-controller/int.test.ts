import { assertEquals } from "#std/assert";
import { targetLangs } from "./mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

/**
 * REQ-262 (demo M25): the job options' languages came from settings only
 * (app language ∪ "Languages you send in"), so a contractor whose send
 * languages were English-only and who typed "… in Spanish and English" got
 * English-only options and descriptionByLang. The typed request now counts.
 */

Deno.test("REQ-262 targetLangs: a typed 'in Spanish and English' adds Spanish to an English-only setup", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const identity = new BusinessIdentityStore();
  await identity.upsert("u-1", { commsLanguages: ["en"] });
  assertEquals(
    await targetLangs(
      identity,
      "u-1",
      "en",
      "Repaint the Garcia kitchen, $1,800 — in Spanish and English please",
    ),
    ["en", "es"],
  );
  await resetKv();
});

Deno.test("REQ-262 targetLangs: no language ask keeps the settings-only set (app language first)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const identity = new BusinessIdentityStore();
  await identity.upsert("u-1", { commsLanguages: ["en"] });
  assertEquals(
    await targetLangs(identity, "u-1", "en", "Tile the bathroom, 80 sqft"),
    ["en"],
  );
  assertEquals(
    await targetLangs(identity, "u-1", "es", "Tile the bathroom, 80 sqft"),
    ["es", "en"],
  );
  await resetKv();
});
