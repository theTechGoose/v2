/**
 * REQ-636 (demo-loop cycle 5, m8) — integration: the real mirror sender and receiver, with the
 * stage's pill sync between them. The customer's pill tucks at t=2000 while the frame showing
 * that page goes out at t=2000 too; the pill message arrives at once, the frames later (the
 * mirror trails by seconds). The ghost must change only when the receiver hands on that frame.
 */
import {
  createMirrorReceiver,
  createMirrorSender,
  type MirrorFrame,
  newLoadId,
} from "../../shared/demo-mode/mirror";
import { createPillSync } from "../../shared/demo-mode/pill-sync";
import type { PeerMessage } from "../../shared/demo-mode/protocol";

const snap: MirrorFrame = {
  t: "snap",
  w: 420,
  h: 800,
  u: "/customers",
  root: { i: 1, t: "html", c: [{ i: 2, t: "body", c: [{ i: 3, x: "a" }] }] },
  ops: [],
};
const ops = (x: string): MirrorFrame => ({
  t: "ops",
  ops: [{ o: "x", i: 3, x }],
});

test("REQ-636 — a pill face is applied when the replay reaches the frame it was sent with, not before", async () => {
  let clock = 1_000;
  const wire: PeerMessage[] = [];
  const sender = createMirrorSender({
    send: (m) => wire.push(m),
    load: newLoadId(3),
    clock: () => clock,
  });
  void sender.push(snap);
  await sender.idle();
  clock = 2_000;
  void sender.push(ops("scrolled"));
  await sender.idle();
  // the pill, stamped by the same clock, goes on the side channel
  const pill = { k: "pill" as const, r: null, tucked: true, t: clock };

  const shown: string[] = [];
  const replayed: string[] = [];
  const pills = createPillSync<typeof pill>({ now: () => 0 });
  const rx = createMirrorReceiver({
    // REQ-636 AMENDMENT (with REQ-639): the frame's `seq` comes before `sent`
    onFrame: (f, _load, _seq, sent) => {
      replayed.push(f.t === "snap" ? "snap" : "ops");
      const p = pills.frame(sent);
      if (p) shown.push(`tucked after ${replayed.length} frames`);
    },
  });
  // the pill arrives first; the replay is still on nothing
  const now = pills.offer(pill, pill.t);
  if (now) shown.push("tucked at once");
  expect(shown).toEqual([]);
  const chunks = wire.filter((m) => m.k === "dom");
  await rx.push(chunks[0]); // the snapshot of t=1000
  await rx.idle();
  expect(shown).toEqual([]);
  for (const c of chunks.slice(1)) await rx.push(c); // the frame of t=2000
  await rx.idle();
  expect(shown).toEqual(["tucked after 2 frames"]);
});
