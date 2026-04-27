import { assert, assertEquals } from "#std/assert";
import { type DomainEvent, EventBus } from "./mod.ts";

function ev(over: Partial<Omit<DomainEvent, "timestamp">> = {}): Omit<DomainEvent, "timestamp"> {
  return {
    userId: "u-1",
    entityType: "quote",
    entityId: "q-1",
    action: "sent",
    ...over,
  };
}

Deno.test("EventBus: emit fans out to every subscriber", async () => {
  const bus = new EventBus();
  const calls: string[] = [];
  bus.subscribe((e) => { calls.push(`A:${e.action}`); });
  bus.subscribe((e) => { calls.push(`B:${e.action}`); });
  await bus.emit(ev({ action: "sent" }));
  assertEquals(calls.sort(), ["A:sent", "B:sent"]);
});

Deno.test("EventBus: emit fills timestamp when omitted", async () => {
  const bus = new EventBus();
  let got: DomainEvent | undefined;
  bus.subscribe((e) => { got = e; });
  await bus.emit(ev());
  assert(got, "listener should have fired");
  assert(typeof got!.timestamp === "string" && got!.timestamp.length > 0);
});

Deno.test("EventBus: emit preserves caller-supplied timestamp", async () => {
  const bus = new EventBus();
  let got: DomainEvent | undefined;
  bus.subscribe((e) => { got = e; });
  await bus.emit({ ...ev(), timestamp: "2026-04-26T12:00:00.000Z" });
  assertEquals(got!.timestamp, "2026-04-26T12:00:00.000Z");
});

Deno.test("EventBus: a listener throwing does NOT crash other listeners", async () => {
  const bus = new EventBus();
  const calls: string[] = [];
  bus.subscribe(() => { throw new Error("boom"); });
  bus.subscribe(() => { calls.push("survived"); });
  await bus.emit(ev());
  assertEquals(calls, ["survived"]);
});

Deno.test("EventBus: subscribe returns an unsubscribe handle", async () => {
  const bus = new EventBus();
  const calls: string[] = [];
  const unsub = bus.subscribe(() => { calls.push("hit"); });
  await bus.emit(ev());
  unsub();
  await bus.emit(ev());
  assertEquals(calls.length, 1);
});

Deno.test("EventBus: reset clears all subscribers", async () => {
  const bus = new EventBus();
  let count = 0;
  bus.subscribe(() => { count++; });
  bus.subscribe(() => { count++; });
  bus.reset();
  await bus.emit(ev());
  assertEquals(count, 0);
});

Deno.test("EventBus: async listeners are awaited (sequential per emit)", async () => {
  const bus = new EventBus();
  const order: number[] = [];
  bus.subscribe(async () => {
    await new Promise((r) => setTimeout(r, 5));
    order.push(1);
  });
  bus.subscribe(() => { order.push(2); });
  await bus.emit(ev());
  // Both listeners run; order doesn't matter, but both must have fired.
  assertEquals(order.sort(), [1, 2]);
});
