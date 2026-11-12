import { assertEquals } from "#std/assert";
import { TranslateBullets } from "./mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";

/**
 * REQ-261 (demo M26): translated job-detail bullets land in the quote's
 * `descriptionByLang`. A translation that ADDS a money amount the source line
 * did not have (the model pulling a private cost into the customer copy) is
 * not trusted — the originals come back instead.
 */
Deno.test("REQ-261 M26 a translation that adds a money amount falls back to the originals", async () => {
  const llm = new StubLLMClient();
  llm.setHandler(() => ({
    text: JSON.stringify({
      texts: ["Instalación de plomería", "El plomero Ray cobra $2,800"],
    }),
  }));
  const coord = new TranslateBullets(llm);
  const texts = ["Plumbing rough-in", "Install shutoff valves"];
  const res = await coord.run({ userId: "u1", texts, to: "es" });
  assertEquals(res.texts, texts);
});

Deno.test("REQ-261 M26 a clean translation passes through", async () => {
  const llm = new StubLLMClient();
  llm.setHandler(() => ({
    text: JSON.stringify({
      texts: ["Instalación de plomería", "Instalar válvulas de cierre"],
    }),
  }));
  const coord = new TranslateBullets(llm);
  const res = await coord.run({
    userId: "u1",
    texts: ["Plumbing rough-in", "Install shutoff valves"],
    to: "es",
  });
  assertEquals(res.texts, [
    "Instalación de plomería",
    "Instalar válvulas de cierre",
  ]);
});
