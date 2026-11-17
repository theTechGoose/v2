// REQ-153 — two hubs on one KV stand in for two Deno Deploy isolates: a message posted in one
// reaches the peer joined in the other through the KV mailbox, a peer in the same hub gets it
// at once and never twice, presence crosses both ways, and an end reaches everyone.
import { assert, assertEquals } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import {
  MIRROR_CHUNK_CHARS,
  parseClientMessage,
  parseServerMessage,
  type Role,
  type ServerMessage,
} from "#demo-mode/protocol.ts";
import { ChunkAssembler, chunkText, newLoadId } from "#demo-mode/mirror.ts";
import { DemoHub, type Peer } from "./mod.ts";

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
      data: { k: "dom", l: "lp0q1x2-ab12", s: 0, i: 0, n: 1, d: "{}" },
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
    assertEquals(hj.peers, [], "no colleague yet");
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
    // REQ-232 — named by pid and by socket
    assertEquals(
      lj.peers,
      [{ role: "presenter", pid: "hans", cid: hj.cid }],
      "the colleague in this hub, by pid",
    );
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

    // the viewer's signal addressed to Lia (REQ-232: to her stage's socket) reaches Lia only;
    // its relay reaches both presenters
    await b.send("s3", { role: "viewer" }, {
      t: "signal",
      data: { sdp: "answer-for-lia" },
      to: lj.cid,
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

Deno.test("REQ-242 full-size mirror chunks cross two isolates through the KV mailbox intact, every one once, and reassemble byte-identical whatever order they come in (two-byte text included)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const presenter = fakePeer("presenter");
  const viewer = fakePeer("viewer");
  try {
    await a.join("m1", presenter);
    await b.join("m1", viewer);
    await until(
      "the presenter hears the viewer",
      () => presenter.inbox.some((m) => m.t === "peer" && m.online),
    );
    // the worst case for a KV value: every chunk at the size limit, every one a two-byte string
    const text = "¿Qué tal? 🚰 “ok” ".repeat(4_000);
    const parts = chunkText(text);
    assert(parts.length >= 4, `${parts.length} chunks`);
    assert(
      parts.slice(0, -1).every((p) =>
        p.length >= MIRROR_CHUNK_CHARS - 1 && p.length <= MIRROR_CHUNK_CHARS
      ),
      "every chunk but the last is full (a surrogate pair is never cut)",
    );
    const l = newLoadId();
    for (const [i, d] of parts.entries()) {
      await b.send("m1", { role: "viewer" }, {
        t: "relay",
        data: { k: "dom", l, s: 0, i, n: parts.length, d },
      });
    }
    await until(
      "every chunk crossed",
      () =>
        presenter.inbox.filter((m) => m.t === "relay").length === parts.length,
      8000,
    );
    const asm = new ChunkAssembler();
    let whole: { text: string } | null = null;
    const got = presenter.inbox.flatMap((m) =>
      m.t === "relay" && m.data.k === "dom" ? [m.data] : []
    );
    // the mailbox orders the mail of one millisecond by its random id, so chunks may cross out of
    // order; the stage's ChunkAssembler (and FrameSequencer, for frames) put them back
    assertEquals(
      got.map((c) => c.i).sort((x, y) => x - y),
      parts.map((_, i) => i),
      "every chunk, once",
    );
    for (const c of got) whole = asm.push(c) ?? whole;
    assertEquals(whole?.text, text, "byte-identical, whatever the order");
  } finally {
    await a.close();
    await b.close();
    await resetKv();
  }
});

// REQ-232 — every socket is its own connection (B3, demo-lifecycle-m1/m3): a customer's two tabs
// arrive and leave under their own cids, so the stage can tell them apart and one tab leaving says
// nothing of the other; a stage's signal can address ONE tab and the tab's answer ONE stage; a
// tab's claim reaches every stage stamped with the tab; a stage's sync reaches one tab; a second
// stage of the same staff account replaces the first (same hub and across hubs); and a reply
// across hubs is addressed to the socket that arrived, never to every tab.
function socketPeer(role: Role, pid?: string) {
  const inbox: ServerMessage[] = [];
  let closed = false;
  return {
    role,
    ...(pid ? { pid } : {}),
    inbox,
    send: (m: ServerMessage) => void inbox.push(m),
    close: () => {
      closed = true;
    },
    isClosed: () => closed,
  };
}

Deno.test("REQ-232 a customer's two tabs are two connections: each arrives and leaves under its own cid, and one leaving says nothing of the other", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const stage = socketPeer("presenter", "hans");
  const tab1 = socketPeer("viewer");
  const tab2 = socketPeer("viewer");
  try {
    const sj = await a.join("s5", stage);
    const t1 = await a.join("s5", tab1);
    const t2 = await a.join("s5", tab2);
    assert(
      typeof sj.cid === "string" && sj.cid.length > 8,
      "the stage's socket has an id of its own",
    );
    assert(
      typeof t1.cid === "string" && typeof t2.cid === "string" &&
        t1.cid !== t2.cid,
      "each tab has its own",
    );
    assertEquals(
      stage.inbox.filter((m) => m.t === "peer"),
      [
        { t: "peer", online: true, cid: t1.cid },
        { t: "peer", online: true, cid: t2.cid },
      ],
      "the stage hears each tab arrive, by cid",
    );
    assertEquals(
      t2.peers,
      [{ role: "presenter", pid: "hans", cid: sj.cid }],
      "a tab joining is told which stages are here (never the other tabs)",
    );
    t2.leave();
    await until(
      "the stage hears tab 2 go",
      () => stage.inbox.some((m) => m.t === "peer" && !m.online),
    );
    await sleep(100);
    assertEquals(
      stage.inbox.filter((m) => m.t === "peer" && !m.online),
      [{ t: "peer", online: false, cid: t2.cid }],
      "tab 2 left — and only tab 2",
    );
    assert(
      !tab1.inbox.some((m) => m.t === "peer" && !m.pid),
      "a tab never hears of the other tabs",
    );
  } finally {
    await a.close();
    await resetKv();
  }
});

Deno.test("REQ-232 a stage's signal addressed to one tab reaches that tab only, and the answer that stage only; a tab's claim reaches every stage stamped with the tab; a stage's sync reaches one tab", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const hans = socketPeer("presenter", "hans");
  const lia = socketPeer("presenter", "lia");
  const tab1 = socketPeer("viewer");
  const tab2 = socketPeer("viewer");
  const far = socketPeer("viewer");
  try {
    const hj = await a.join("s6", hans);
    const lj = await a.join("s6", lia);
    const t1 = await a.join("s6", tab1);
    const t2 = await a.join("s6", tab2);
    const fj = await b.join("s6", far);

    await a.send("s6", { role: "presenter", pid: "hans", cid: hj.cid }, {
      t: "signal",
      data: { sdp: "offer" },
      to: t1.cid,
    });
    assertEquals(tab1.inbox.filter((m) => m.t === "signal"), [{
      t: "signal",
      from: "presenter",
      pid: "hans",
      cid: hj.cid,
      data: { sdp: "offer" },
    }], "tab 1 has the offer, stamped with the stage it is from");
    assertEquals(
      tab2.inbox.filter((m) => m.t === "signal"),
      [],
      "the other tab never gets an offer meant for tab 1",
    );

    await a.send("s6", { role: "viewer", cid: t1.cid }, {
      t: "signal",
      data: { sdp: "answer" },
      to: hj.cid,
    });
    assertEquals(hans.inbox.filter((m) => m.t === "signal"), [{
      t: "signal",
      from: "viewer",
      cid: t1.cid,
      data: { sdp: "answer" },
    }], "the answer reaches the stage it is for, stamped with the tab");
    assertEquals(
      lia.inbox.filter((m) => m.t === "signal"),
      [],
      "never a colleague's stage",
    );

    // tab 2 claims: every stage hears it, stamped tab 2; tabs never do
    await a.send("s6", { role: "viewer", cid: t2.cid }, {
      t: "claim",
      at: 1700,
    });
    for (const p of [hans, lia]) {
      assertEquals(p.inbox.filter((m) => m.t === "claim"), [{
        t: "claim",
        cid: t2.cid,
        at: 1700,
      }]);
    }
    assert(!tab1.inbox.some((m) => m.t === "claim"), "tabs never hear claims");

    // a stage asks tab 2 for its whole view: tab 2 only
    await a.send("s6", { role: "presenter", pid: "hans", cid: hj.cid }, {
      t: "sync",
      to: t2.cid,
    });
    assertEquals(tab2.inbox.filter((m) => m.t === "sync"), [{ t: "sync" }]);
    assertEquals(tab1.inbox.filter((m) => m.t === "sync"), []);
    // a tab cannot sync another, and a stage cannot claim
    await a.send("s6", { role: "viewer", cid: t1.cid }, {
      t: "sync",
      to: t2.cid,
    });
    await a.send("s6", { role: "presenter", pid: "lia", cid: lj.cid }, {
      t: "claim",
      at: 9,
    });
    assertEquals(tab2.inbox.filter((m) => m.t === "sync").length, 1);
    assertEquals(hans.inbox.filter((m) => m.t === "claim").length, 1);

    // across hubs: the tab on hub b gets the offer addressed to it, nobody on hub a does
    await a.send("s6", { role: "presenter", pid: "hans", cid: hj.cid }, {
      t: "signal",
      data: { sdp: "offer-far" },
      to: fj.cid,
    });
    await until(
      "the far tab gets its offer",
      () => far.inbox.some((m) => m.t === "signal"),
    );
    await sleep(200);
    assertEquals(
      [tab1, tab2].map((t) =>
        t.inbox.filter((m) =>
          m.t === "signal" &&
          (m.data as { sdp?: string }).sdp === "offer-far"
        ).length
      ),
      [0, 0],
    );
  } finally {
    await a.close();
    await b.close();
    await resetKv();
  }
});

// REQ-393 (demo-loop cycle 2, M2) — a presenter's relay may name ONE customer tab (`tab`: its
// cid): the stage's pointer goes to the tab it follows, and its `leave` to the tab it just left; the
// customer's other tabs and the colleagues never get that copy (the colleagues have their own,
// `to: "presenters"`).
Deno.test("REQ-393 a presenter's relay addressed to one tab reaches that tab only — never the customer's other tab nor a colleague — in one hub and across two", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const hans = socketPeer("presenter", "hans");
  const lia = socketPeer("presenter", "lia");
  const tab1 = socketPeer("viewer");
  const tab2 = socketPeer("viewer");
  const far = socketPeer("viewer");
  const relays = (p: { inbox: ServerMessage[] }) =>
    p.inbox.filter((m) => m.t === "relay");
  try {
    const hj = await a.join("s9", hans);
    await a.join("s9", lia);
    const t1 = await a.join("s9", tab1);
    await a.join("s9", tab2);
    const fj = await b.join("s9", far);
    const stamp = { from: "presenter" as const, pid: "hans", cid: hj.cid };

    // the stage left tab 1: tab 1 alone hears the leave
    await a.send("s9", { role: "presenter", pid: "hans", cid: hj.cid }, {
      t: "relay",
      data: { k: "leave" },
      tab: t1.cid,
    });
    assertEquals(relays(tab1), [{
      t: "relay",
      ...stamp,
      data: { k: "leave" },
    }]);

    // it follows the tab on the other isolate now: its move (off their screen) goes there only
    const off = {
      k: "move" as const,
      a: { vx: 0, vy: 0.4, o: 1 as const },
      t: 12,
    };
    await a.send("s9", { role: "presenter", pid: "hans", cid: hj.cid }, {
      t: "relay",
      data: off,
      tab: fj.cid,
    });
    await until(
      "the far tab gets the move addressed to it",
      () => relays(far).some((m) => m.t === "relay" && m.data.k === "move"),
    );
    await sleep(200);
    assertEquals(relays(far), [{ t: "relay", ...stamp, data: off }]);
    assertEquals(relays(tab1).length, 1, "tab 1 got only its own leave");
    assertEquals(relays(tab2), [], "the customer's other tab gets none of it");
    assertEquals(relays(lia), [], "a colleague gets none of the tabs' copies");
    assertEquals(relays(hans), [], "never the sender");
  } finally {
    await a.close();
    await b.close();
    await resetKv();
  }
});

Deno.test("REQ-232 a second stage of the same staff account replaces the first — in the same hub and across hubs: the older is told and closed, the customer hears it go and the newer come, a colleague is untouched", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const w1 = socketPeer("presenter", "hans");
  const w2 = socketPeer("presenter", "hans");
  const w3 = socketPeer("presenter", "hans");
  const lia = socketPeer("presenter", "lia");
  const tab = socketPeer("viewer");
  try {
    const j1 = await a.join("s7", w1);
    await a.join("s7", lia);
    await a.join("s7", tab);
    const j2 = await a.join("s7", w2);
    assertEquals(
      w1.inbox.filter((m) => m.t === "replaced"),
      [{ t: "replaced" }],
      "window 1 is told it is replaced",
    );
    assert(w1.isClosed(), "… and its socket is closed");
    assert(!w2.inbox.some((m) => m.t === "replaced"), "window 2 is not");
    assert(
      !lia.isClosed() && !lia.inbox.some((m) => m.t === "replaced"),
      "a colleague is untouched",
    );
    // window 1's socket closes (the controller's onclose): the customer hears it go, by cid
    j1.leave();
    await until(
      "the tab hears window 1 go",
      () =>
        tab.inbox.some((m) => m.t === "peer" && !m.online && m.cid === j1.cid),
    );
    assertEquals(
      tab.inbox.filter((m) => m.t === "peer" && m.pid === "hans").map((m) =>
        m.t === "peer" ? [m.online, m.cid] : null
      ),
      [[true, j2.cid], [false, j1.cid]],
      "the customer hears window 2 come and window 1 go",
    );

    // across hubs: window 3 opens on hub b, later — window 2 on hub a is replaced through the
    // mailbox, and window 2's own replacement (hub b's room looks a second back) never closes it
    await sleep(5);
    const j3 = await b.join("s7", w3);
    await until(
      "window 2 is told across hubs",
      () => w2.inbox.some((m) => m.t === "replaced"),
    );
    assert(w2.isClosed());
    assert(!w3.inbox.some((m) => m.t === "replaced"));
    await until(
      "window 3 hears the tab (the reply from hub a)",
      () => w3.inbox.some((m) => m.t === "peer" && m.online && !m.pid),
    );
    assert(
      !w3.inbox.some((m) => m.t === "peer" && m.online && m.pid === "hans"),
      "never told its own account is here",
    );
    assert(typeof j3.cid === "string" && j3.cid !== j2.cid);
  } finally {
    await a.close();
    await b.close();
    await resetKv();
  }
});

Deno.test("REQ-232 across hubs a reply is addressed to the socket that arrived: a stage hears each tab by cid, and a tab arriving later is answered alone", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const tab1 = socketPeer("viewer");
  const tab2 = socketPeer("viewer");
  const tab3 = socketPeer("viewer");
  const stage = socketPeer("presenter", "hans");
  try {
    const t1 = await b.join("s8", tab1);
    const t2 = await b.join("s8", tab2);
    const sj = await a.join("s8", stage);
    // a new room looks one second back into the mailbox, so a presence may come twice: by cid
    // it is the same tab
    const tabsHeard = () =>
      new Set(
        stage.inbox.flatMap((m) =>
          m.t === "peer" && m.online && !m.pid ? [m.cid] : []
        ),
      );
    await until(
      "the stage hears both tabs (the replies), by cid",
      () => tabsHeard().size === 2,
    );
    assertEquals(tabsHeard(), new Set([t1.cid, t2.cid]));
    await until(
      "each tab hears the stage arrive, by pid and cid",
      () =>
        [tab1, tab2].every((t) =>
          t.inbox.some((m) =>
            m.t === "peer" && m.online && m.pid === "hans" && m.cid === sj.cid
          )
        ),
    );
    // past the mailbox's look-back: a third tab arrives on hub b — the stage on hub a answers IT,
    // and only it
    await sleep(1200);
    const before = [tab1.inbox.length, tab2.inbox.length];
    await b.join("s8", tab3);
    await until(
      "tab 3 hears the stage (the reply)",
      () =>
        tab3.inbox.some((m) =>
          m.t === "peer" && m.pid === "hans" && m.cid === sj.cid
        ),
    );
    await sleep(300);
    assertEquals(
      [tab1, tab2].map((t, i) =>
        t.inbox.slice(before[i]).filter((m) => m.t === "peer").length
      ),
      [0, 0],
      "the answer to tab 3 reached tab 3 alone",
    );
  } finally {
    await a.close();
    await b.close();
    await resetKv();
  }
});

// REQ-235 — who ended it: an end a presenter caused names them (`pid`) to every peer, in this
// hub at once and in the other through the mailbox; the customer's end never carries one.
Deno.test("REQ-235 an end by a presenter names them to every peer, across hubs; the customer's end carries no pid", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const hans = stampedPeer("presenter", "hans");
  const lia = stampedPeer("presenter", "lia");
  const viewer = stampedPeer("viewer");
  const hans2 = stampedPeer("presenter", "hans");
  const viewer2 = stampedPeer("viewer");
  try {
    await a.join("s4", hans);
    await a.join("s4", lia);
    await b.join("s4", viewer);
    await a.end("s4", "presenter", undefined, "lia");
    const byLia: ServerMessage = { t: "ended", by: "presenter", pid: "lia" };
    assertEquals(
      hans.inbox.find((m) => m.t === "ended"),
      byLia,
      "the colleague in the same hub hears who ended it, at once",
    );
    assertEquals(lia.inbox.find((m) => m.t === "ended"), byLia);
    await until(
      "the customer in the other hub hears who ended it",
      () => viewer.inbox.some((m) => m.t === "ended"),
    );
    assertEquals(viewer.inbox.find((m) => m.t === "ended"), byLia);

    await a.join("s5", hans2);
    await b.join("s5", viewer2);
    await b.end("s5", "viewer", undefined, "hans");
    await until(
      "the presenter hears the customer's end",
      () => hans2.inbox.some((m) => m.t === "ended"),
    );
    assertEquals(
      hans2.inbox.find((m) => m.t === "ended"),
      { t: "ended", by: "viewer" },
      "the customer's end names no presenter",
    );
  } finally {
    await a.close();
    await b.close();
    await resetKv();
  }
});

// REQ-296 — demo-loop cycle 1, issue nc-3: the two-hour expiry was a silent KV `expireIn`; now the
// hub arms a clock from the demo's createdAt and, at expiry, ends it for everyone, everywhere
Deno.test("REQ-296 a demo that reaches its TTL ends for everyone across hubs: both hear `ended … expired` and are closed, the store says it is over; a demo already ended arms no clock", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.set("DEMO_SESSION_TTL_MS", "1500");
  await resetKv();
  const { DemoSessionStore } = await import(
    "@demo-mode/domain/data/demo-session-store/mod.ts"
  );
  const store = new DemoSessionStore();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const closable = (role: Role, pid?: string) => {
    const p = { ...stampedPeer(role, pid), closed: 0, close() {} };
    p.close = () => void p.closed++;
    return p;
  };
  const hans = closable("presenter", "hans");
  const viewer = closable("viewer");
  const hans2 = closable("presenter", "hans");
  try {
    const demo = await store.create("ana", {
      userId: "hans",
      name: "Hans",
      color: "#2f6d29",
    });
    await a.join(demo.id, hans);
    await b.join(demo.id, viewer);
    await until(
      "the presenter hears the customer arrive",
      () => hans.inbox.some((m) => m.t === "peer" && m.online),
    );
    const expired: ServerMessage = {
      t: "ended",
      by: "presenter",
      reason: "expired",
    };
    await until(
      "the presenter hears the expiry",
      () => hans.inbox.some((m) => m.t === "ended"),
      4000,
    );
    await until(
      "the customer in the other hub hears the expiry",
      () => viewer.inbox.some((m) => m.t === "ended"),
      4000,
    );
    assertEquals(hans.inbox.find((m) => m.t === "ended"), expired);
    assertEquals(viewer.inbox.find((m) => m.t === "ended"), expired);
    assert(hans.closed >= 1, "the presenter's socket is closed");
    assert(viewer.closed >= 1, "the customer's socket is closed");
    const after = await store.get(demo.id);
    assert(
      after === null || typeof after.endedAt === "string",
      "the demo is over in the store",
    );
    assertEquals(await store.activeFor("ana"), null, "active says nothing");
    assertEquals(await store.presentingBy("hans"), null);

    // a demo ended before its time arms nothing: the hub closes without a clock to wait on
    const demo2 = await store.create("ana", {
      userId: "hans",
      name: "Hans",
      color: "#2f6d29",
    });
    await store.end(demo2.id);
    await a.join(demo2.id, hans2);
    await sleep(50);
    assertEquals(hans2.inbox.filter((m) => m.t === "ended"), []);
  } finally {
    Deno.env.delete("DEMO_SESSION_TTL_MS");
    await a.close();
    await b.close();
    await resetKv();
  }
});

// REQ-391 — demo-loop cycle 2, M4 + m21: a customer's tab says, as its page goes, WHY (it is
// navigating to another page of the app, or no next page is known: closing); the controller keeps
// that on the peer and the hub stamps it on the tab's `peer … online:false` — in this hub and,
// through the mailbox, in every other — so the stage knows at once whether to wait for a next page.
// A tab that said nothing is announced as before.
Deno.test("REQ-391 a tab that said why it goes is announced gone with that reason, in this hub and across hubs; one that said nothing without one", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const stage = socketPeer("presenter", "hans");
  const near = socketPeer("viewer");
  const far = socketPeer("viewer");
  const mute = socketPeer("viewer");
  try {
    await a.join("s391", stage);
    const n = await a.join("s391", near);
    const f = await b.join("s391", far);
    const m = await a.join("s391", mute);
    const gone = () =>
      stage.inbox.filter((x) => x.t === "peer" && !x.online && !x.pid);
    (near as Peer).leaving = "navigating";
    n.leave();
    (far as Peer).leaving = "closing";
    f.leave();
    m.leave();
    await until("the stage hears all three go", () => gone().length === 3);
    const byCid = new Map(gone().map((x) => [x.t === "peer" ? x.cid : "", x]));
    assertEquals(byCid.get(n.cid), {
      t: "peer",
      online: false,
      cid: n.cid,
      why: "navigating",
    });
    assertEquals(byCid.get(f.cid), {
      t: "peer",
      online: false,
      cid: f.cid,
      why: "closing",
    }, "across hubs too");
    assertEquals(byCid.get(m.cid), { t: "peer", online: false, cid: m.cid });
  } finally {
    await a.close();
    await b.close();
    await resetKv();
  }
});

// REQ-648 — demo-loop cycle 5, M3 + c4-m28: the stage's lag figure started at each frame's push,
// so the seconds a customer's next page took to boot read 0.0 s. The controller stamps WHEN a
// tab's page said it was going (`leftAt`, the deploy's clock) and the hub puts it on the tab's
// departure (`at`) — here and, through the mailbox, in every other hub — so the stage times the
// page change from that moment to the next page on show. A tab that said nothing has no stamp.
Deno.test("REQ-648 a tab's departure carries when its page said it was going (`at`, the deploy's clock), in this hub and across hubs; a silent tab's has none", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const stage = socketPeer("presenter", "hans");
  const near = socketPeer("viewer");
  const far = socketPeer("viewer");
  const mute = socketPeer("viewer");
  try {
    await a.join("s648", stage);
    const n = await a.join("s648", near);
    const f = await b.join("s648", far);
    const m = await a.join("s648", mute);
    const gone = () =>
      stage.inbox.filter((x) => x.t === "peer" && !x.online && !x.pid);
    Object.assign(near as Peer, {
      leaving: "navigating",
      leftAt: 1_700_000_000_123,
    });
    n.leave();
    Object.assign(far as Peer, {
      leaving: "navigating",
      leftAt: 1_700_000_000_456,
    });
    f.leave();
    m.leave();
    await until("the stage hears all three go", () => gone().length === 3);
    const byCid = new Map(gone().map((x) => [x.t === "peer" ? x.cid : "", x]));
    assertEquals(byCid.get(n.cid), {
      t: "peer",
      online: false,
      cid: n.cid,
      why: "navigating",
      at: 1_700_000_000_123,
    });
    assertEquals(byCid.get(f.cid), {
      t: "peer",
      online: false,
      cid: f.cid,
      why: "navigating",
      at: 1_700_000_000_456,
    }, "across hubs too");
    assertEquals(byCid.get(m.cid), { t: "peer", online: false, cid: m.cid });
    // the stage's own parse keeps it
    assertEquals(parseServerMessage(JSON.stringify(byCid.get(f.cid))), {
      t: "peer",
      online: false,
      cid: f.cid,
      why: "navigating",
      at: 1_700_000_000_456,
    });
  } finally {
    await a.close();
    await b.close();
    await resetKv();
  }
});

// REQ-372 (demo-loop cycle 2, m1) — the customer's pill reaches the stage with what it SAYS: the
// raw relay goes through the socket's parse, across two isolates, and the stage's parse — the
// compact/open state, the status, the text and the overflow flag all survive.
Deno.test("REQ-372 a pill message keeps its words across the socket parse and two hubs", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const presenter = fakePeer("presenter");
  const viewer = fakePeer("viewer");
  try {
    await a.join("s372", presenter);
    await b.join("s372", viewer);
    const pill = {
      k: "pill",
      r: { left: 12, top: 790, width: 400, height: 40 },
      compact: true,
      open: false,
      status: "live",
      text: "Hans is guiding you",
      clipped: true,
    };
    const m = parseClientMessage(JSON.stringify({ t: "relay", data: pill }));
    assert(m && m.t === "relay", "the socket accepts the pill");
    await b.send("s372", { role: "viewer" }, m);
    await until(
      "the stage gets the pill",
      () => presenter.inbox.some((x) => x.t === "relay"),
    );
    const got = presenter.inbox.find((x) => x.t === "relay")!;
    const onStage = parseServerMessage(JSON.stringify(got));
    assertEquals(onStage as unknown, {
      t: "relay",
      from: "viewer",
      data: pill,
    });
  } finally {
    await a.close();
    await b.close();
    await resetKv();
  }
});

// REQ-430 (demo-loop cycle 3, m4) — the pill's status in the CUSTOMER's words and the guide's
// short name survive the socket parse and two hubs, so the stage's ghost can say them.
Deno.test("REQ-430 a pill message keeps its translated status label and guide name across the socket parse and two hubs", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const presenter = fakePeer("presenter");
  const viewer = fakePeer("viewer");
  try {
    await a.join("s430", presenter);
    await b.join("s430", viewer);
    const pill = {
      k: "pill",
      r: { left: 12, top: 790, width: 200, height: 40 },
      compact: true,
      open: false,
      status: "live",
      label: "Conectado",
      text: "Hans te está guiando",
      guide: "Hans",
      clipped: false,
    };
    const m = parseClientMessage(JSON.stringify({ t: "relay", data: pill }));
    assert(m && m.t === "relay", "the socket accepts the pill");
    await b.send("s430", { role: "viewer" }, m);
    await until(
      "the stage gets the pill",
      () => presenter.inbox.some((x) => x.t === "relay"),
    );
    const got = presenter.inbox.find((x) => x.t === "relay")!;
    assertEquals(parseServerMessage(JSON.stringify(got)) as unknown, {
      t: "relay",
      from: "viewer",
      data: pill,
    });
  } finally {
    await a.close();
    await b.close();
    await resetKv();
  }
});

Deno.test("REQ-378 (demo-loop cycle 2, m22) a joining stage is greeted — welcome and who is here — BEFORE anyone hears it arrive: a tab that answers the arrival at once (its first snapshot) is never ahead of the stage's welcome", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  /** what reached the stage's socket, in order — the greeting included */
  const order: string[] = [];
  const stage = {
    role: "presenter" as Role,
    pid: "hans",
    send: (m: ServerMessage) => void order.push(m.t),
  };
  // the customer's tab: hearing a stage arrive, it sends its whole view at once (the transport's
  // onPeerOnline → snapshot), before anything else happens
  const tab = {
    role: "viewer" as Role,
    cid: "tab-1",
    send: (m: ServerMessage) => {
      if (m.t === "peer" && m.online && m.pid === "hans") {
        void a.send("s-m22", { role: "viewer", cid: "tab-1" }, {
          t: "relay",
          data: { k: "dom", l: "lp0q1x2-ab12", s: 0, i: 0, n: 1, d: "{}" },
        });
      }
    },
  };
  try {
    await a.join("s-m22", tab);
    let greeted: { cid: string; peers: { cid: string }[] } | null = null;
    await a.join("s-m22", stage, (g) => {
      greeted = g;
      order.push("greet");
    });
    await until(
      "the tab's snapshot reaches the stage",
      () => order.includes("relay"),
    );
    assertEquals(
      order[0],
      "greet",
      `the stage is greeted before the tab's answer: ${order.join(",")}`,
    );
    assertEquals(
      greeted!.peers.map((p) => p.cid),
      ["tab-1"],
      "the greeting lists the tab already here",
    );
  } finally {
    await a.close();
    await resetKv();
  }
});

Deno.test("REQ-436 (demo-loop cycle 3, M2/M2b) a tab's claim carries its browser tab's key and whether it has focus — to every stage, in one hub and across two; a bad key is dropped, never the claim", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const hans = socketPeer("presenter", "hans");
  const lia = socketPeer("presenter", "lia");
  const tab1 = socketPeer("viewer");
  try {
    await a.join("s436", hans);
    await b.join("s436", lia);
    const t1 = await a.join("s436", tab1);
    // what the browser sends, off the wire as the socket controller reads it
    const claim = parseClientMessage(
      JSON.stringify({ t: "claim", at: 1700, tab: "k-tab_1", f: 1 }),
    );
    assertEquals(claim, { t: "claim", at: 1700, tab: "k-tab_1", f: 1 });
    if (claim?.t !== "claim") throw new Error("not a claim");
    await a.send("s436", { role: "viewer", cid: t1.cid }, claim);
    const want: ServerMessage = {
      t: "claim",
      cid: t1.cid,
      at: 1700,
      tab: "k-tab_1",
      f: 1,
    };
    assertEquals(hans.inbox.filter((m) => m.t === "claim"), [want]);
    await until(
      "the stage on the other hub hears it too",
      () => lia.inbox.some((m) => m.t === "claim"),
    );
    assertEquals(lia.inbox.filter((m) => m.t === "claim"), [want]);
    assertEquals(
      parseServerMessage(JSON.stringify(want)),
      want,
      "the stage's parser keeps the key and the focus",
    );
    // a claim from before REQ-436 (no key) and junk keys: still a claim, without the key
    assertEquals(
      parseClientMessage(JSON.stringify({ t: "claim", at: 5 })),
      { t: "claim", at: 5 },
    );
    assertEquals(
      parseClientMessage(
        JSON.stringify({ t: "claim", at: 5, tab: "<script>", f: "yes" }),
      ),
      { t: "claim", at: 5 },
    );
    assertEquals(
      parseServerMessage(
        JSON.stringify({ t: "claim", cid: "c", at: 5, tab: "x".repeat(65) }),
      ),
      { t: "claim", cid: "c", at: 5 },
    );
  } finally {
    await a.close();
    await b.close();
  }
});

// REQ-642 (demo-loop cycle 5, m10 + setup-14d) — the customer's overlay reports back where it
// placed each presenter's arrow (`placed`: the anchor, the tip as a viewport fraction, outside),
// and the stage draws his ghost from that report. The raw text the customer's socket sends passes
// the server's gate (parseClientMessage), crosses two isolates, and reaches every stage — each
// keeps the one naming its own pid — stamped as the viewer's, and parses on the stage's side.
Deno.test("REQ-642 the customer's placed report passes the server's gate, crosses two isolates and reaches every stage intact", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const hans = stampedPeer("presenter", "hans");
  const lia = stampedPeer("presenter", "lia");
  const viewer = stampedPeer("viewer");
  try {
    await a.join("s642", hans);
    await a.join("s642", lia);
    await b.join("s642", viewer);
    const data = {
      k: "placed" as const,
      pid: "hans",
      a: { vx: 0.5, vy: 0.5, n: { id: 7, x: 0.5, y: 0.5, l: "L1" } },
      p: { vx: 0.25, vy: 0.75 },
    };
    const raw = JSON.stringify({ t: "relay", data });
    const m = parseClientMessage(raw);
    assert(
      m?.t === "relay",
      "the server's gate drops the customer's placed report",
    );
    await b.send("s642", { role: "viewer" }, m);
    for (const [who, p] of [["hans", hans], ["lia", lia]] as const) {
      await until(
        `${who}'s stage gets the report`,
        () => p.inbox.some((x) => x.t === "relay" && x.data.k === "placed"),
      );
      const got = p.inbox.find((x) => x.t === "relay" && x.data.k === "placed");
      assertEquals(parseServerMessage(JSON.stringify(got)), {
        t: "relay",
        from: "viewer",
        data,
      });
    }
  } finally {
    await a.close();
    await b.close();
    await resetKv();
  }
});

// REQ-640 (demo-loop cycle 5, m24 + M29) — a stage that joins (or reloads) learned the customer's
// tabs as bare `peer`s and followed the one that arrived LAST (at 0) until each tab reclaimed. The
// hub now keeps each customer socket's last claim (at, browser-tab key, focus, input-backed) and
// sends it with the roster: in the joining stage's greeting in this hub, and on the reply a hub
// sends a stage that arrives on another. A tab that leaves takes its claim with it.
Deno.test("REQ-640 (demo-loop cycle 5, m24) a joining stage's roster carries each tab's last claim — in its greeting in this hub and on the replies across hubs; an input-backed claim says so (i: 1)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const b = DemoHub.isolated("b");
  const tab1 = socketPeer("viewer");
  const tab2 = socketPeer("viewer");
  const hans = socketPeer("presenter", "hans");
  const lia = socketPeer("presenter", "lia");
  try {
    const t1 = await a.join("s640", tab1);
    const t2 = await a.join("s640", tab2);
    const input = parseClientMessage(
      JSON.stringify({ t: "claim", at: 300, tab: "tab-A", f: 1, i: 1 }),
    );
    assertEquals(input, { t: "claim", at: 300, tab: "tab-A", f: 1, i: 1 });
    if (input?.t !== "claim") throw new Error("not a claim");
    await a.send("s640", { role: "viewer", cid: t1.cid }, input);
    await a.send("s640", { role: "viewer", cid: t2.cid }, {
      t: "claim",
      at: 0,
      tab: "tab-Q",
    });

    // a stage joining THIS hub: its greeting lists both tabs with their claims
    const g = await a.join("s640", hans);
    const byCid = new Map(g.peers.map((p) => [p.cid, p]));
    assertEquals(byCid.get(t1.cid), {
      role: "viewer",
      cid: t1.cid,
      at: 300,
      tab: "tab-A",
      f: 1,
      i: 1,
    });
    assertEquals(byCid.get(t2.cid), {
      role: "viewer",
      cid: t2.cid,
      at: 0,
      tab: "tab-Q",
    });

    // a stage joining ANOTHER hub: the replies from hub a carry the claims too
    await b.join("s640", lia);
    await until(
      "the stage on hub b hears tab 1 with its claim",
      () =>
        lia.inbox.some((m) =>
          m.t === "peer" && m.online && m.cid === t1.cid && m.at === 300
        ),
    );
    // (the room's one-second look-back may also replay tab 1's bare arrival from before it claimed)
    const heard = lia.inbox.find((m) =>
      m.t === "peer" && m.online && m.cid === t1.cid && m.at !== undefined
    )!;
    assertEquals(heard, {
      t: "peer",
      online: true,
      cid: t1.cid,
      at: 300,
      tab: "tab-A",
      f: 1,
      i: 1,
    });
    assertEquals(
      parseServerMessage(JSON.stringify(heard)),
      heard,
      "the stage's parser keeps the roster claim",
    );
    // a tab that leaves takes its claim along: a later stage hears nothing of it
    t1.leave();
    const g2 = await a.join("s640", socketPeer("presenter", "max"));
    assertEquals(g2.peers.some((p) => p.cid === t1.cid), false);
  } finally {
    await a.close();
    await b.close();
    await resetKv();
  }
});

Deno.test("REQ-640 (demo-loop cycle 5, M29) a live claim reaches every stage with i: 1 when it was input-backed; junk `i` is dropped, never the claim", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const a = DemoHub.isolated("a");
  const hans = socketPeer("presenter", "hans");
  const tab1 = socketPeer("viewer");
  try {
    await a.join("s640b", hans);
    const t1 = await a.join("s640b", tab1);
    await a.send("s640b", { role: "viewer", cid: t1.cid }, {
      t: "claim",
      at: 900,
      tab: "tab-A",
      i: 1,
    });
    assertEquals(hans.inbox.filter((m) => m.t === "claim"), [
      { t: "claim", cid: t1.cid, at: 900, tab: "tab-A", i: 1 },
    ]);
    assertEquals(
      parseServerMessage(
        JSON.stringify({ t: "claim", cid: "c", at: 5, i: 1 }),
      ),
      { t: "claim", cid: "c", at: 5, i: 1 },
    );
    assertEquals(
      parseClientMessage(JSON.stringify({ t: "claim", at: 5, i: "yes" })),
      { t: "claim", at: 5 },
    );
  } finally {
    await a.close();
    await resetKv();
  }
});
