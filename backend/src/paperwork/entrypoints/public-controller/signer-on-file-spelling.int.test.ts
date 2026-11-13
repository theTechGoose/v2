/**
 * REQ-750 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5v1, issue p18-6a (re-verified NOT FIXED after
 * REQ-692): the agreement was made out to "Carmen Núñez", the customer typed
 * "Carmen Nunez", and the accept stored the unaccented spelling — the signed
 * copy then read "FIRMA DE CARMEN NUNEZ" / "Gracias, Carmen Nunez".
 *
 * Integration over HTTP, app booted: a typed name that differs from the name
 * on file only by accents, case or spacing is stored in the on-file spelling
 * (and echoed as `acceptedName`); a genuinely different name still signs as
 * typed (rejecting a mismatch stays the owner's call).
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;
const USER = "u-req750-signer";

Deno.test("REQ-750 p18-6a (cycle 5v1): 'Carmen Nunez' signing Carmen Núñez's agreement is stored as 'Carmen Núñez'; a different name is kept as typed", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const quotes = new QuoteStore();
    const carmen = await new CustomerStore().create(USER, {
      name: "Carmen Núñez",
    });
    const sentQuote = async () =>
      (await quotes.create(USER, {
        customerId: carmen.id,
        summary: "Reparación de puerta",
        lineItems: [],
        estimatedTotal: 350_00,
        status: "sent",
      })).id;
    const accept = async (id: string, name: string) => {
      const r = await fetch(`${BASE}/quotes/${id}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, signature: "data:image/png;x" }),
      });
      return { status: r.status, body: await r.json() };
    };

    for (const typed of ["Carmen Nunez", "  carmen   NUNEZ "]) {
      const id = await sentQuote();
      const r = await accept(id, typed);
      assertEquals(r.status, 200, JSON.stringify(r.body));
      assertEquals(r.body.acceptedName, "Carmen Núñez", typed);
      assertEquals((await quotes.get(id)).acceptedName, "Carmen Núñez", typed);
    }

    const other = await sentQuote();
    const r = await accept(other, "Luis Núñez");
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals(r.body.acceptedName, "Luis Núñez");
    assertEquals((await quotes.get(other)).acceptedName, "Luis Núñez");
  } finally {
    await server.stop();
    await resetKv();
  }
});
