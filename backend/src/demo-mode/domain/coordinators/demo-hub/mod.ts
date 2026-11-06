import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import {
  otherRole,
  type PeerMessage,
  type Role,
  type ServerMessage,
} from "#demo-mode/protocol.ts";

/** a connected browser as the hub sees it — a WebSocket in the controller, a fake in the test */
export interface Peer {
  role: Role;
  send(m: ServerMessage): void;
  /** the demo ended: the hub asks the socket to close after the last message */
  close?(): void;
}

/** what crosses isolates: a message for one role (or everyone) in a demo, stamped with the isolate that wrote it */
interface Mail {
  id: string;
  origin: string;
  to: Role | "all";
  msg: ServerMessage;
  /** a presence announce that wants the other side's presence back */
  reply?: boolean;
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

  async join(
    sessionId: string,
    peer: Peer,
  ): Promise<{ peerOnline: boolean; leave: () => void }> {
    const room = await this.room(sessionId);
    const peerOnline = [...room.peers].some((p) =>
      p.role === otherRole(peer.role)
    );
    room.peers.add(peer);
    await this.broadcast(sessionId, {
      to: otherRole(peer.role),
      msg: { t: "peer", online: true },
      reply: true,
    });
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      room.peers.delete(peer);
      // fire-and-forget: a peer leaving after the KV closed (shutdown, test
      // teardown) must not surface as an unhandled rejection
      this.broadcast(sessionId, {
        to: otherRole(peer.role),
        msg: { t: "peer", online: false },
      }).catch(() => {});
      if (room.peers.size === 0) this.drop(sessionId, room);
    };
    return { peerOnline, leave };
  }

  /** a signal or a relay from `from` to the other side */
  send(
    sessionId: string,
    from: Role,
    m: { t: "signal"; data: unknown } | { t: "relay"; data: PeerMessage },
  ): Promise<void> {
    const msg: ServerMessage = m.t === "signal"
      ? { t: "signal", from, data: m.data }
      : { t: "relay", from, data: m.data };
    return this.broadcast(sessionId, { to: otherRole(from), msg });
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
      if (mail.to !== "all" && p.role !== mail.to) continue;
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
      // a presence announce from elsewhere: if the side it is for is here, say so back
      if (
        mail.reply && mail.to !== "all" &&
        [...room.peers].some((p) => p.role === mail.to)
      ) {
        replies.push({
          to: otherRole(mail.to),
          msg: { t: "peer", online: true },
        });
      }
    }
    for (const r of replies) await this.broadcast(sessionId, r);
  }
}
