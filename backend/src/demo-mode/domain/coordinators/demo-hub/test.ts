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

    await a.send("s1", { role: "presenter" }, {
      t: "signal",
      data: { sdp: "offer" },
    });
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
    await a.send("s1", { role: "presenter" }, {
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

    await b.send("s1", { role: "viewer" }, {
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

// REQ-214 — two presenters and a viewer across two hubs: presence names the presenter, a
// presenter's relay reaches the viewer AND the colleague stamped with who sent it, a relay for
// the presenters only never reaches the viewer, the viewer's signal can address one presenter,
// the viewer's relay reaches every presenter, and a presenter leaving is announced to all.
function stampedPeer(role: Role, pid?: string) {
  const inbox: ServerMessage[] = [];
  return { role, pid, inbox, send: (m: ServerMessage) => void inbox.push(m) };
}

Deno.test("REQ-214 two presenters on one demo: presence, stamped relays, presenters-only relays, addressed signals, leaving", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const hans = stampedPeer("presenter", "hans");
  const lia = stampedPeer("presenter", "lia");
  const viewer = stampedPeer("viewer");
  try {
    const hj = await a.join("s3", hans);
    assertEquals(hj.peerOnline, false);
    assertEquals(hj.others, [], "no colleague yet");
    await b.join("s3", viewer);
    await until(
      "the viewer hears Hans is there, by name",
      () =>
        viewer.inbox.some((m) =>
          m.t === "peer" && m.online && m.pid === "hans"
        ),
    );
    await until(
      "Hans hears the viewer",
      () => hans.inbox.some((m) => m.t === "peer" && m.online && !m.pid),
    );

    const lj = await a.join("s3", lia);
    assertEquals(lj.peerOnline, false, "the viewer is on the other hub");
    assertEquals(lj.others, ["hans"], "the colleague in this hub, by pid");
    assertEquals(
      hans.inbox.filter((m) => m.t === "peer" && m.online && m.pid === "lia")
        .length,
      1,
      "Hans hears Lia arrive, at once",
    );
    await until(
      "the viewer hears Lia arrive, by name",
      () =>
        viewer.inbox.some((m) => m.t === "peer" && m.online && m.pid === "lia"),
    );
    await until(
      "Lia hears the viewer is there (the reply from the other hub)",
      () => lia.inbox.some((m) => m.t === "peer" && m.online && !m.pid),
    );
    assert(
      !lia.inbox.some((m) => m.t === "peer" && m.pid === "lia"),
      "nobody is told of themselves",
    );

    // Hans's click: the viewer and Lia get it, stamped hans; Hans never does
    await a.send("s3", { role: "presenter", pid: "hans" }, {
      t: "relay",
      data: { k: "click", a: { vx: 0.1, vy: 0.2 } },
    });
    assertEquals(lia.inbox.filter((m) => m.t === "relay"), [{
      t: "relay",
      from: "presenter",
      pid: "hans",
      data: { k: "click", a: { vx: 0.1, vy: 0.2 } },
    }], "the colleague in the same hub has it as soon as send resolves");
    await until(
      "the viewer gets Hans's click, stamped",
      () =>
        viewer.inbox.some((m) =>
          m.t === "relay" && m.from === "presenter" && m.pid === "hans"
        ),
    );
    assert(
      !hans.inbox.some((m) => m.t === "relay"),
      "never back to the sender",
    );

    // Hans's pointer for his colleagues only: Lia gets it, the viewer never
    await a.send("s3", { role: "presenter", pid: "hans" }, {
      t: "relay",
      data: { k: "leave" },
      to: "presenters",
    });
    assertEquals(
      lia.inbox.filter((m) => m.t === "relay" && m.data.k === "leave").length,
      1,
    );
    await sleep(300);
    assert(
      !viewer.inbox.some((m) => m.t === "relay" && m.data.k === "leave"),
      "a presenters-only relay never reaches the viewer",
    );

    // the viewer's signal addressed to Lia reaches Lia only; its relay reaches both presenters
    await b.send("s3", { role: "viewer" }, {
      t: "signal",
      data: { sdp: "answer-for-lia" },
      to: "lia",
    });
    await until(
      "Lia gets the answer",
      () => lia.inbox.some((m) => m.t === "signal"),
    );
    assertEquals(lia.inbox.find((m) => m.t === "signal"), {
      t: "signal",
      from: "viewer",
      data: { sdp: "answer-for-lia" },
    });
    await b.send("s3", { role: "viewer" }, {
      t: "relay",
      data: { k: "move", a: { vx: 0.5, vy: 0.5 } },
    });
    await until(
      "both presenters get the viewer's move",
      () =>
        hans.inbox.some((m) => m.t === "relay" && m.from === "viewer") &&
        lia.inbox.some((m) => m.t === "relay" && m.from === "viewer"),
    );
    await sleep(200);
    assert(
      !hans.inbox.some((m) => m.t === "signal"),
      "a signal addressed to Lia never reaches Hans",
    );

    // Lia leaves: Hans and the viewer hear it, by name
    lj.leave();
    await until(
      "Hans hears Lia go",
      () =>
        hans.inbox.some((m) => m.t === "peer" && !m.online && m.pid === "lia"),
    );
    await until(
      "the viewer hears Lia go",
      () =>
        viewer.inbox.some((m) =>
          m.t === "peer" && !m.online && m.pid === "lia"
        ),
    );
  } finally {
    await a.close();
    await b.close();
    await resetKv();
  }
});
