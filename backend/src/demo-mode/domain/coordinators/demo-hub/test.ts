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
