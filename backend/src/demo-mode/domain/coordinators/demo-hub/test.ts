// REQ-153 — two hubs on one KV stand in for two Deno Deploy isolates: a message posted in one
// reaches the peer joined in the other through the KV mailbox, a peer in the same hub gets it
// at once and never twice, presence crosses both ways, and an end reaches everyone.
import { assert, assertEquals } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import type { Role, ServerMessage } from "#demo-mode/protocol.ts";
import { DemoHub } from "./mod.ts";

function fakePeer(role: Role) {
  const inbox: ServerMessage[] = [];
  return { role, inbox, send: (m: ServerMessage) => void inbox.push(m) };
}
async function until(what: string, ok: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out: ${what}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.test("REQ-153 two hubs on one KV — a message posted in one reaches the peer joined in the other, a local peer gets it once, presence and end", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const presenter = fakePeer("presenter");
  const viewer = fakePeer("viewer");
  const viewer2 = fakePeer("viewer");
  try {
    const pj = await a.join("s1", presenter);
    assertEquals(pj.peerOnline, false, "nobody else yet");
    await b.join("s1", viewer);
    await until(
      "the presenter hears the viewer arrive across isolates",
      () => presenter.inbox.some((m) => m.t === "peer" && m.online),
    );
    await until(
      "the viewer hears the presenter is there (the reply)",
      () => viewer.inbox.some((m) => m.t === "peer" && m.online),
    );

    await a.send("s1", "presenter", { t: "signal", data: { sdp: "offer" } });
    await until(
      "the signal crosses",
      () => viewer.inbox.some((m) => m.t === "signal"),
    );
    const sig = viewer.inbox.find((m) => m.t === "signal")!;
    assertEquals(sig, {
      t: "signal",
      from: "presenter",
      data: { sdp: "offer" },
    });
    assert(
      !presenter.inbox.some((m) => m.t === "signal"),
      "the sender's own side never gets its message",
    );

    const vj = await a.join("s1", viewer2);
    assertEquals(vj.peerOnline, true, "the presenter is in this hub");
    await a.send("s1", "presenter", {
      t: "relay",
      data: { k: "view", v: { path: "/customers" } },
    });
    assertEquals(
      viewer2.inbox.filter((m) => m.t === "relay").length,
      1,
      "the local peer has it as soon as send resolves",
    );
    await until(
      "the remote viewer gets the relay",
      () => viewer.inbox.some((m) => m.t === "relay"),
    );
    await sleep(300);
    assertEquals(
      viewer2.inbox.filter((m) => m.t === "relay").length,
      1,
      "and never a second copy off the mailbox",
    );
    assertEquals(viewer.inbox.filter((m) => m.t === "relay").length, 1);

    await b.send("s1", "viewer", {
      t: "relay",
      data: { k: "move", a: { vx: 0.5, vy: 0.5 } },
    });
    await until(
      "the other direction crosses",
      () => presenter.inbox.some((m) => m.t === "relay"),
    );
    assertEquals(presenter.inbox.find((m) => m.t === "relay"), {
      t: "relay",
      from: "viewer",
      data: { k: "move", a: { vx: 0.5, vy: 0.5 } },
    });
    assert(
      !viewer2.inbox.some((m) => m.t === "relay" && m.from === "viewer"),
      "a viewer's message does not come back to viewers",
    );

    await b.end("s1", "viewer");
    await until(
      "the end reaches the other isolate",
      () => presenter.inbox.some((m) => m.t === "ended"),
    );
    assertEquals(presenter.inbox.find((m) => m.t === "ended"), {
      t: "ended",
      by: "viewer",
    });
    await until(
      "and every peer there",
      () => viewer2.inbox.some((m) => m.t === "ended"),
    );
  } finally {
    await a.close();
    await b.close();
    await resetKv();
  }
});

Deno.test("REQ-153 a peer leaving tells the other side it is offline", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const presenter = fakePeer("presenter");
  const viewer = fakePeer("viewer");
  try {
    await a.join("s2", presenter);
    const vj = await a.join("s2", viewer);
    assertEquals(
      presenter.inbox.filter((m) => m.t === "peer" && m.online).length,
      1,
    );
    vj.leave();
    await until(
      "offline",
      () => presenter.inbox.some((m) => m.t === "peer" && !m.online),
    );
  } finally {
    await a.close();
    await resetKv();
  }
});
