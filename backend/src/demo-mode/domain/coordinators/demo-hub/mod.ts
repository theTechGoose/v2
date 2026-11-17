import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import {
  type ClientMessage,
  type EndReason,
  type LeaveWhy,
  otherRole,
  type Role,
  type ServerMessage,
} from "#demo-mode/protocol.ts";
import { DemoSessionStore } from "@demo-mode/domain/data/demo-session-store/mod.ts";

/** a connected browser as the hub sees it — a WebSocket in the controller, a fake in the test.
 *  REQ-214 — a presenter carries their `pid`; the viewer has none. REQ-232 — every socket has its
 *  own `cid` (a customer's tab, a staff stage): the controller's, or one `join` gives it */
export interface Peer {
  role: Role;
  pid?: string;
  cid?: string;
  send(m: ServerMessage): void;
  /** the demo ended (or this presenter was dropped or replaced): the hub asks the socket to close after the last message */
  close?(): void;
  /** REQ-391 — what a customer tab's page said as it went (the controller keeps it from the
   *  socket's `leaving`): its departure carries it, so a stage knows whether a next page comes */
  leaving?: LeaveWhy;
  /** REQ-648 (demo-loop cycle 5, M3) — when it said so, on the deploy's clock (the controller
   *  stamps it): its departure carries it, so a stage times the page change from it */
  leftAt?: number;
}

/** REQ-214 — who a message is from: the viewer, or a presenter by pid; REQ-232 — and which socket */
export interface From {
  role: Role;
  pid?: string;
  cid?: string;
}

/** REQ-640 (demo-loop cycle 5, m24) — a customer tab's last claim, as the hub keeps it */
export interface KeptClaim {
  at: number;
  tab?: string;
  f?: 1;
  i?: 1;
}

/** REQ-232 — a socket already in the demo, as a joining one is told of it. REQ-640 — a customer
 *  tab carries its last claim, so a joining stage ranks it without waiting for a reclaim */
export interface PeerInfo extends Partial<KeptClaim> {
  role: Role;
  pid?: string;
  cid: string;
}

/** REQ-378 — what a joining socket is told first: its own id, whether the other side is here, who is */
export interface Greeting {
  cid: string;
  peerOnline: boolean;
  peers: PeerInfo[];
}

/** what crosses isolates: a message for one role (or everyone) in a demo, stamped with the isolate that wrote it */
interface Mail {
  id: string;
  origin: string;
  /** REQ-232 — when it was written: a drop or a replacement reaches only the sockets that joined
   *  before it (a new room looks a second back into the mailbox, and must not close a newcomer) */
  at?: number;
  to: Role | "all";
  /** REQ-232 — for ONE socket only */
  cid?: string;
  /** REQ-214 — never to this presenter (any socket of theirs) */
  except?: string;
  msg: ServerMessage;
  /** a presence announce that wants the other side's presence back */
  reply?: boolean;
  /** REQ-214 — this presenter was dropped from the demo: their sockets everywhere close */
  drop?: string;
  /** REQ-232 — this presenter opened the demo in a newer window (`keep`): their other sockets,
   *  everywhere, are told (`replaced`) and closed */
  replace?: { pid: string; keep: string };
}

interface Room {
  peers: Set<Peer>;
  reader: ReadableStreamDefaultReader<Deno.KvEntryMaybe<unknown>[]> | null;
  /** mail keys already delivered here (ids seen at or after `cursor`) */
  seen: Set<string>;
  cursor: number;
  done: Promise<void>;
  /** REQ-296 — the demo's clock: when it expires, and the timer that ends it then */
  expiry: { at: number; timer: ReturnType<typeof setTimeout> } | null;
}

const MAIL_TTL_MS = 60_000;
const mailPrefix = (sessionId: string) =>
  ["demo-mode", "mail", sessionId] as const;
const tickKey = (sessionId: string) =>
  ["demo-mode", "tick", sessionId] as const;

/**
 * REQ-153 — the signaling server's fan-out. On Deno Deploy the presenter's socket and the
 * viewer's may land on different isolates, so a message is delivered to the peers in THIS
 * process at once and posted to a KV mailbox for the others: every hub with a peer in the demo
 * watches the demo's tick key and delivers what it has not seen, skipping its own mail. A peer
 * in the same process therefore gets a message exactly once, and a peer elsewhere gets it as
 * soon as `kv.watch` fires. Mail expires after a minute; nothing is replayed to a late joiner.
 *
 * REQ-296 — a demo's two hours are kept here too (demo-loop cycle 1, nc-3: the KV expiry was
 * silent). The first join in a hub arms one clock for the room at the demo's `expiresAt`; when it
 * fires the demo is stamped ended in the store and `ended … expired` goes to everyone, in every
 * isolate (each hub with a room has its own clock; the first broadcast closes the sockets, which
 * empties the rooms and clears the rest). A room going empty, or the hub closing, clears it.
 */
@Injectable()
export class DemoHub {
  private rooms = new Map<string, Room>();
  private isolateId: string = crypto.randomUUID();
  /** REQ-232 — when each socket here joined */
  private joinedAt = new WeakMap<Peer, number>();
  /** REQ-640 (cycle 5, m24) — each customer socket's last claim here, by cid (gone when it leaves) */
  private claims = new Map<string, KeptClaim>();

  constructor(private demos: DemoSessionStore) {}

  /** a hub standing in for a named isolate (tests: two hubs on one KV) */
  static isolated(isolateId: string): DemoHub {
    const hub = new DemoHub(new DemoSessionStore());
    hub.isolateId = isolateId;
    return hub;
  }

  /** join: `cid` (REQ-232) — this socket's own id; `peerOnline` — the other side is in THIS hub (a
   *  presenter: a customer tab; the viewer: any presenter); `peers` — who in this hub the welcome
   *  lists: a customer tab is told of the stages, a stage of the tabs and of the other accounts'
   *  stages. Everyone else hears the arrival (with its cid; a presenter's names them too) and,
   *  elsewhere, replies to it with their own presence. REQ-232 — a presenter's newer window takes
   *  over: their older sockets, here and elsewhere, are told they are replaced and closed.
   *  REQ-378 (demo-loop cycle 2, m22) — `greet` runs the moment the socket is in the room, BEFORE
   *  anyone hears it arrive: the socket's welcome and who is here go out first, so an answer to
   *  its arrival (a tab's snapshot, sent the instant it hears a stage) never overtakes them. */
  async join(
    sessionId: string,
    peer: Peer,
    greet?: (g: Greeting) => void,
  ): Promise<Greeting & { leave: () => void }> {
    const cid = peer.cid ??= crypto.randomUUID();
    const room = await this.room(sessionId);
    this.joinedAt.set(peer, Date.now());
    const peerOnline = [...room.peers].some((p) =>
      p.role === otherRole(peer.role)
    );
    const listed = (p: Peer): p is Peer & { cid: string } => {
      if (p === peer || !p.cid) return false;
      if (p.role === "viewer") return peer.role === "presenter";
      return !(peer.role === "presenter" && p.pid === peer.pid);
    };
    const peers = [...room.peers].filter(listed).map((p): PeerInfo => ({
      role: p.role,
      ...(p.pid ? { pid: p.pid } : {}),
      cid: p.cid,
      ...(p.role === "viewer" ? this.claims.get(p.cid) : {}),
    }));
    // in the room before anything is awaited: a last peer leaving meanwhile must not drop it
    room.peers.add(peer);
    greet?.({ cid, peerOnline, peers });
    await this.armExpiry(sessionId, room);
    if (peer.role === "presenter" && peer.pid) {
      await this.broadcast(sessionId, {
        to: "presenter",
        msg: { t: "replaced" },
        replace: { pid: peer.pid, keep: cid },
      });
    }
    await this.broadcast(sessionId, this.presence(peer, true, true));
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      // a presenter dropped from the demo (REQ-214) was taken out and announced already
      const wasIn = room.peers.delete(peer);
      this.claims.delete(cid);
      // fire-and-forget: a peer leaving after the KV closed (shutdown, test
      // teardown) must not surface as an unhandled rejection
      if (wasIn) {
        this.broadcast(sessionId, this.presence(peer, false)).catch(() => {});
      }
      if (room.peers.size === 0) this.drop(sessionId, room);
    };
    return { cid, peerOnline, peers, leave };
  }

  /** REQ-214 — a presenter's presence goes to everyone else (never to their own account's other
   *  sockets), named; a customer tab's to the presenters. REQ-232 — each says which socket.
   *  REQ-391 — a customer tab's departure says why it went, when its page said so; REQ-648 — and
   *  when it said so (`at`, the deploy's clock) */
  private presence(
    peer: Peer,
    online: boolean,
    reply = false,
  ): Omit<Mail, "id" | "origin"> {
    const cid = peer.cid ? { cid: peer.cid } : {};
    if (peer.role === "presenter" && peer.pid) {
      return {
        to: "all",
        except: peer.pid,
        msg: { t: "peer", online, pid: peer.pid, ...cid },
        reply,
      };
    }
    const why = !online && peer.leaving ? { why: peer.leaving } : {};
    const at = !online && peer.leftAt ? { at: peer.leftAt } : {};
    // REQ-640 — a tab still here says its last claim with its presence (a stage on another hub
    // learns it from this reply, and ranks the tab at once)
    const kept = online && peer.cid ? this.claims.get(peer.cid) : undefined;
    return {
      to: otherRole(peer.role),
      msg: { t: "peer", online, ...cid, ...why, ...at, ...kept },
      reply,
    };
  }

  /** a message from `from`, stamped with who sent it (pid) and from which socket (cid, REQ-232):
   *  a signal goes to the other side — to ONE socket when it is addressed (`to`: a cid); a
   *  presenter's relay to the customer and the other presenters (`to: "presenters"` — the others
   *  only), a customer tab's to the presenters; a tab's `claim` to every stage; a stage's `sync` to
   *  the one tab it names */
  send(
    sessionId: string,
    from: From,
    // REQ-391 — `leaving` and `time` are the socket's own business (the controller's), never sent on
    m: Exclude<ClientMessage, { t: "end" | "leaving" | "time" }>,
  ): Promise<void> {
    const stamp = {
      ...(from.pid ? { pid: from.pid } : {}),
      ...(from.cid ? { cid: from.cid } : {}),
    };
    if (m.t === "claim") {
      if (from.role !== "viewer" || !from.cid) return Promise.resolve();
      // REQ-436 — and which browser tab it is, and whether its page has focus; REQ-640 — and
      // whether the customer's input backs it. Kept, for a stage that joins later (m24)
      const kept: KeptClaim = {
        at: m.at,
        ...(m.tab ? { tab: m.tab } : {}),
        ...(m.f === 1 ? { f: 1 as const } : {}),
        ...(m.i === 1 ? { i: 1 as const } : {}),
      };
      if (this.isHere(sessionId, from.cid)) this.claims.set(from.cid, kept);
      return this.broadcast(sessionId, {
        to: "presenter",
        msg: { t: "claim", cid: from.cid, ...kept },
      });
    }
    if (m.t === "sync") {
      if (from.role !== "presenter") return Promise.resolve();
      return this.broadcast(sessionId, {
        to: "viewer",
        cid: m.to,
        msg: { t: "sync" },
      });
    }
    if (m.t === "signal") {
      return this.broadcast(sessionId, {
        to: otherRole(from.role),
        ...(m.to ? { cid: m.to } : {}),
        msg: { t: "signal", from: from.role, ...stamp, data: m.data },
      });
    }
    const msg: ServerMessage = {
      t: "relay",
      from: from.role,
      ...stamp,
      data: m.data,
    };
    if (from.role === "viewer") {
      return this.broadcast(sessionId, { to: "presenter", msg });
    }
    // REQ-393 — a presenter's relay for ONE customer tab: the tab its stage follows, or the one it
    // just left (a `leave`) — never the customer's other tabs, never the colleagues (theirs is the
    // `to: "presenters"` copy)
    if (m.tab) {
      return this.broadcast(sessionId, { to: "viewer", cid: m.tab, msg });
    }
    // a presenter without a pid (a demo written before the list) has no colleagues to reach
    if (!from.pid) {
      if (m.to === "presenters") return Promise.resolve();
      return this.broadcast(sessionId, { to: "viewer", msg });
    }
    return this.broadcast(sessionId, {
      to: m.to === "presenters" ? "presenter" : "all",
      except: from.pid,
      msg,
    });
  }

  /** REQ-214 — a presenter left the demo (for another customer): everyone hears it and their
   *  sockets on this demo close, in every isolate */
  dropPresenter(sessionId: string, pid: string): Promise<void> {
    return this.broadcast(sessionId, {
      to: "all",
      except: pid,
      msg: { t: "peer", online: false, pid },
      drop: pid,
    });
  }

  /** the demo is over: everyone hears it and is closed. REQ-235 — `pid`: the presenter who ended
   *  it, said to everyone (the viewer's end names nobody) */
  end(
    sessionId: string,
    by: Role,
    reason?: EndReason,
    pid?: string,
  ): Promise<void> {
    return this.broadcast(sessionId, {
      to: "all",
      msg: {
        t: "ended",
        by,
        ...(reason ? { reason } : {}),
        ...(by === "presenter" && pid ? { pid } : {}),
      },
    });
  }

  /** REQ-640 — socket `cid` is in this hub's room for the demo (a claim kept for a gone socket
   *  would never be cleared) */
  private isHere(sessionId: string, cid: string): boolean {
    const room = this.rooms.get(sessionId);
    return !!room && [...room.peers].some((p) => p.cid === cid);
  }

  /** stop every watcher (tests, shutdown) */
  async close(): Promise<void> {
    this.claims.clear();
    for (const [id, room] of this.rooms) {
      room.peers.clear();
      this.drop(id, room);
      await room.done;
    }
  }

  /** REQ-296 — the room's clock, once: at the demo's `expiresAt` (a demo already over, or
   *  unknown, gets none). Already due: it fires on the next tick, after the welcome is sent. */
  private async armExpiry(sessionId: string, room: Room): Promise<void> {
    if (room.expiry) return;
    const demo = await this.demos.get(sessionId);
    if (!demo || demo.endedAt || this.rooms.get(sessionId) !== room) return;
    if (room.expiry) return;
    const at = this.demos.expiresAt(demo);
    const timer = setTimeout(() => {
      room.expiry = null;
      this.expire(sessionId).catch(() => {});
    }, Math.max(0, at - Date.now()));
    room.expiry = { at, timer };
  }

  /** the demo reached its time: over in the store (pointers gone), then said to everyone */
  private async expire(sessionId: string): Promise<void> {
    await this.demos.end(sessionId).catch(() => null);
    await this.end(sessionId, "presenter", "expired");
  }

  private async broadcast(
    sessionId: string,
    mail: Omit<Mail, "id" | "origin">,
  ): Promise<void> {
    const full: Mail = {
      id: crypto.randomUUID(),
      origin: this.isolateId,
      at: Date.now(),
      ...mail,
    };
    const room = this.rooms.get(sessionId);
    if (room) this.deliver(room, full, true);
    const kv = await getKv();
    await kv.atomic()
      .set([...mailPrefix(sessionId), Date.now(), full.id], full, {
        expireIn: MAIL_TTL_MS,
      })
      .sum(tickKey(sessionId), 1n)
      .commit();
  }

  /** `local`: written by this hub, now — every socket here joined before it */
  private deliver(room: Room, mail: Mail, local = false): void {
    for (const p of [...room.peers]) {
      // REQ-232 — a drop or a replacement from elsewhere reaches only the sockets that joined
      // before it was written: a new room looks a second back into the mailbox, and a newer
      // window of the same account must never be closed by an older one's mail
      const joined = this.joinedAt.get(p) ?? 0;
      const at = mail.at ?? Number.POSITIVE_INFINITY;
      const older = local || joined < at;
      if (mail.drop && p.pid === mail.drop) {
        if (older) {
          room.peers.delete(p);
          p.close?.();
        }
        continue;
      }
      if (mail.replace) {
        const { pid, keep } = mail.replace;
        // two windows that joined in the same millisecond on two isolates: the lower cid goes,
        // the same on both sides, so exactly one stays
        const first = older || (joined === at && (p.cid ?? "") < keep);
        if (
          p.role === "presenter" && p.pid === pid && p.cid !== keep && first
        ) {
          try {
            p.send(mail.msg);
          } catch {
            // gone already
          }
          // its own close announces it gone, by cid
          p.close?.();
        }
        continue;
      }
      if (mail.to !== "all" && p.role !== mail.to) continue;
      if (mail.cid && p.cid !== mail.cid) continue;
      if (mail.except && p.pid === mail.except) continue;
      try {
        p.send(mail.msg);
      } catch {
        // a peer gone mid-send is dropped by its own close
      }
      if (mail.msg.t === "ended") p.close?.();
    }
  }

  private async room(sessionId: string): Promise<Room> {
    const have = this.rooms.get(sessionId);
    if (have) return have;
    const kv = await getKv();
    const room: Room = {
      peers: new Set(),
      reader: null,
      seen: new Set(),
      cursor: Date.now() - 1000,
      done: Promise.resolve(),
      expiry: null,
    };
    this.rooms.set(sessionId, room);
    const reader = kv.watch([tickKey(sessionId)]).getReader();
    room.reader = reader;
    room.done = (async () => {
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
          await this.drain(sessionId, room, kv);
        }
      } catch {
        // cancelled
      }
    })();
    return room;
  }

  private drop(sessionId: string, room: Room): void {
    if (this.rooms.get(sessionId) === room) this.rooms.delete(sessionId);
    if (room.expiry) clearTimeout(room.expiry.timer);
    room.expiry = null;
    void room.reader?.cancel();
  }

  /** deliver the mail since the cursor that did not come from here */
  private async drain(
    sessionId: string,
    room: Room,
    kv: Deno.Kv,
  ): Promise<void> {
    const start = [...mailPrefix(sessionId), room.cursor] as Deno.KvKey;
    const replies: Omit<Mail, "id" | "origin">[] = [];
    for await (
      const e of kv.list<Mail>({ prefix: mailPrefix(sessionId), start })
    ) {
      const mail = e.value;
      const ts = Number(e.key[3]);
      if (ts > room.cursor) room.cursor = ts;
      if (room.seen.has(mail.id)) continue;
      room.seen.add(mail.id);
      if (room.seen.size > 500) {
        room.seen.delete(room.seen.values().next().value!);
      }
      if (mail.origin === this.isolateId) continue;
      this.deliver(room, mail);
      // a presence announce from elsewhere: whoever it is for and is here says so back, to THAT
      // socket only (REQ-232) — a customer tab's announce gets every local stage's presence; a
      // stage's gets every local tab's and every local stage of another account
      if (mail.reply && mail.msg.t === "peer" && mail.msg.online) {
        const { pid: arrived, cid } = mail.msg;
        const to = cid ? { cid } : {};
        for (const p of room.peers) {
          if (arrived) {
            if (p.pid === arrived) continue;
            replies.push({
              to: "presenter",
              ...to,
              msg: this.presence(p, true).msg,
            });
          } else if (p.role === "presenter") {
            replies.push({
              to: "viewer",
              ...to,
              msg: this.presence(p, true).msg,
            });
          }
        }
      }
    }
    for (const r of replies) await this.broadcast(sessionId, r);
  }
}
