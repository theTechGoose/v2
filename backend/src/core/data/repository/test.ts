import { assertEquals, assertRejects } from "#std/assert";
import { NotFoundError, Repository, type StoredEntity } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

interface Widget extends StoredEntity {
  name: string;
}

Deno.test("repository smoke: full CRUD against real Deno.Kv", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const repo = new Repository<Widget>("widget-smk");

  const created = await repo.create({ name: "alpha" });
  assertEquals(created.name, "alpha");

  const fetched = await repo.get(created.id);
  assertEquals(fetched.id, created.id);

  const updated = await repo.update(created.id, { name: "beta" });
  assertEquals(updated.name, "beta");

  const all = await repo.list();
  assertEquals(all.length, 1);

  await repo.delete(created.id);
  await assertRejects(() => repo.get(created.id), NotFoundError);

  await resetKv();
});
