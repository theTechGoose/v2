import { assertEquals } from "#std/assert";
import { SummarizePaperworkViews } from "./mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("summarize-paperwork-views integration: counts and bounds the views for one quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const views = new ViewStore();
  const flow = new SummarizePaperworkViews(views);

  await views.create({ paperworkType: "quote", paperworkId: "q-1", viewedAt: "2026-04-26T10:00:00Z", viewerEmail: "ops@acme.test" });
  await views.create({ paperworkType: "quote", paperworkId: "q-1", viewedAt: "2026-04-26T13:00:00Z", viewerEmail: "ops@acme.test" });
  await views.create({ paperworkType: "quote", paperworkId: "q-2", viewedAt: "2026-04-26T11:00:00Z" });

  const summary = await flow.run("quote", "q-1");
  assertEquals(summary.views.length, 2);
  assertEquals(summary.stats.total, 2);
  assertEquals(summary.stats.uniqueViewers, 1);
  assertEquals(summary.stats.firstViewedAt, "2026-04-26T10:00:00Z");
  assertEquals(summary.stats.lastViewedAt, "2026-04-26T13:00:00Z");

  await resetKv();
});
