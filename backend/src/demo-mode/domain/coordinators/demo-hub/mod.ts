import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import {
  otherRole,
  type PeerMessage,
  type Role,
  type ServerMessage,
} from "#demo-mode/protocol.ts";

/** a connected browser as the hub sees it — a WebSocket in the controller, a fake in the test.
 *  REQ-214 — a presenter carries their `pid`; the viewer has none */
export interface Peer {
  role: Role;
  pid?: string;
  send(m: ServerMessage): void;
  /** the demo ended (or this presenter was dropped): the hub asks the socket to close after the last message */
  close?(): void;
}

/** REQ-214 — who a message is from: the viewer, or a presenter by pid */
export interface From {
  role: Role;
  pid?: string;
}

/** what crosses isolates: a message for one role (or everyone) in a demo, stamped with the isolate that wrote it */
interface Mail {
  id: string;
  origin: string;
  to: Role | "all";
  /** REQ-214 — for ONE presenter (by pid) only */
  pid?: string;
  /** REQ-214 — never back to this presenter */
  except?: string;
  msg: ServerMessage;
  /** a presence announce that wants the other side's presence back */
  reply?: boolean;
  /** REQ-214 — this presenter was dropped from the demo: their sockets everywhere close */
  drop?: string;
}

interface Room {
  peers: Set<Peer>;
  reader: ReadableStreamDefaultReader<Deno.KvEntryMaybe<unknown>[]> | null;
  /** mail keys already delivered here (ids seen at or after `cursor`) */
  seen: Set<string>;
  cursor: number;
  done: Promise<void>;
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
 */
@Injectable()
export class DemoHub {
  private rooms = new Map<string, Room>();
  private isolateId: string = crypto.randomUUID();

  /** a hub standing in for a named isolate (tests: two hubs on one KV) */
  static isolated(isolateId: string): DemoHub {
    const hub = new DemoHub();
    hub.isolateId = isolateId;
    return hub;
  }

  /** join: `peerOnline` — the other side is in THIS hub (a presenter: the viewer; the viewer: any
   *  presenter); `others` (REQ-214) — the other presenters in this hub, by pid, for the welcome to
   *  list. Everyone else hears the arrival (a presenter's announce names them) and, elsewhere,
   *  replies with their own presence. */
  async join(
    sessionId: string,
    peer: Peer,
  ): Promise<{ peerOnline: boolean; others: string[]; leave: () => void }> {
    const room = await this.room(sessionId);
    const peerOnline = [...room.peers].some((p) =>
      p.role === otherRole(peer.role)
    );
    const others = [...room.peers].flatMap((p) =>
      p.role === "presenter" && p.pid && p !== peer ? [p.pid] : []
    );
    room.peers.add(peer);
    await this.broadcast(sessionId, this.presence(peer, true, true));
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      // a presenter dropped from the demo (REQ-214) was taken out and announced already
      const wasIn = room.peers.delete(peer);
      // fire-and-forget: a peer leaving after the KV closed (shutdown, test
      // teardown) must not surface as an unhandled rejection
      if (wasIn) {
        this.broadcast(sessionId, this.presence(peer, false)).catch(() => {});
      }
      if (room.peers.size === 0) this.drop(sessionId, room);
    };
    return { peerOnline, others, leave };
  }

  /** REQ-214 — a presenter's presence goes to everyone else, named; the viewer's to the presenters */
  private presence(
    peer: Peer,
    online: boolean,
    reply = false,
  ): Omit<Mail, "id" | "origin"> {
    if (peer.role === "presenter" && peer.pid) {
      return {
        to: "all",
        except: peer.pid,
        msg: { t: "peer", online, pid: peer.pid },
        reply,
      };
    }
    return { to: otherRole(peer.role), msg: { t: "peer", online }, reply };
  }

  /** a signal or a relay from `from`: a presenter's goes to the viewer and the other presenters
   *  (`to: "presenters"` — the others only), stamped with their pid; the viewer's goes to the
   *  presenters, a signal to the one it is addressed to */
  send(
    sessionId: string,
    from: From,
    m:
      | { t: "signal"; data: unknown; to?: string }
      | { t: "relay"; data: PeerMessage; to?: "presenters" },
  ): Promise<void> {
    const stamp = from.pid ? { pid: from.pid } : {};
    const msg: ServerMessage = m.t === "signal"
      ? { t: "signal", from: from.role, ...stamp, data: m.data }
      : { t: "relay", from: from.role, ...stamp, data: m.data };
    if (from.role === "viewer") {
      return this.broadcast(sessionId, {
        to: "presenter",
        ...(m.t === "signal" && m.to ? { pid: m.to } : {}),
        msg,
      });
    }
    if (m.t === "signal") {
      return this.broadcast(sessionId, { to: "viewer", msg });
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

  /** the demo is over: everyone hears it and is closed */
  end(sessionId: string, by: Role, reason?: "declined"): Promise<void> {
    return this.broadcast(sessionId, {
      to: "all",
      msg: reason ? { t: "ended", by, reason } : { t: "ended", by },
    });
  }

  /** stop every watcher (tests, shutdown) */
  async close(): Promise<void> {
    for (const [id, room] of this.rooms) {
      room.peers.clear();
      this.drop(id, room);
      await room.done;
    }
  }

  private async broadcast(
    sessionId: string,
    mail: Omit<Mail, "id" | "origin">,
  ): Promise<void> {
    const full: Mail = {
      id: crypto.randomUUID(),
      origin: this.isolateId,
      ...mail,
    };
    const room = this.rooms.get(sessionId);
    if (room) this.deliver(room, full);
    const kv = await getKv();
    await kv.atomic()
      .set([...mailPrefix(sessionId), Date.now(), full.id], full, {
        expireIn: MAIL_TTL_MS,
      })
      .sum(tickKey(sessionId), 1n)
      .commit();
  }

  private deliver(room: Room, mail: Mail): void {
    for (const p of [...room.peers]) {
      if (mail.drop && p.pid === mail.drop) {
        room.peers.delete(p);
        p.close?.();
        continue;
      }
      if (mail.to !== "all" && p.role !== mail.to) continue;
      if (mail.pid && p.pid !== mail.pid) continue;
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
      // a presence announce from elsewhere: whoever it is for and is here says so back —
      // REQ-214: the viewer's announce gets every local presenter's presence, named; a
      // presenter's gets the viewer's (unnamed) and each local presenter's (named), to them only
      if (mail.reply && mail.msg.t === "peer") {
        const arrived = mail.msg.pid;
        for (const p of room.peers) {
          if (arrived) {
            if (p.pid === arrived) continue;
            replies.push({
              to: "presenter",
              pid: arrived,
              msg: p.role === "viewer"
                ? { t: "peer", online: true }
                : { t: "peer", online: true, pid: p.pid },
            });
          } else if (p.role === "presenter") {
            replies.push({
              to: "viewer",
              msg: { t: "peer", online: true, pid: p.pid },
            });
          }
        }
      }
    }
    for (const r of replies) await this.broadcast(sessionId, r);
  }
}
