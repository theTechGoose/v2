/**
 * REQ-153 — one demo link: the WebSocket to the deploy (signaling, presence, and the relay) and,
 * on top of it, WebRTC peer connections the presenters offer — STUN only, no TURN — with an
 * unreliable data channel for pointer moves and a reliable one for clicks and routes. A message
 * rides the data channels when they are open and the WebSocket relay otherwise; `status` says
 * which. The socket reconnects with backoff; a refused socket (the demo ended, the session is
 * nobody in it) ends in `closed` so the overlay can ask `active` again.
 *
 * REQ-214 — several presenters: a presenter holds ONE connection, to the customer; the
 * customer holds one PER presenter. The customer's message goes to every presenter (on every
 * channel when all are open, else through the relay); a presenter's goes to the customer on the
 * channel or the relay AND to the other presenters through the relay (`to: "presenters"`), so
 * every stage shows the colleagues' pointers. `onPeer` says who a message is from.
 *
 * REQ-232 — every socket is its own connection (`cid`, stamped by the server): a customer's tabs
 * and a presenter's stages are SETS, never one yes/no flag. A stage keeps the customer's tabs and
 * says "waiting" only when none is left — and only after PRESENCE_GRACE_MS, since a page change
 * in the customer's app is a new socket. It follows ONE tab, the one the customer used last (a
 * tab `claim`s it when it is in front, gets focus or is clicked; the claim carries the tab's own
 * clock, so every stage picks the same tab); it connects to that tab only, asks it for its whole
 * view (`sync`) whenever it starts following it, and never hands the stage another tab's
 * messages. The customer keeps one connection per stage — two windows of one staff account
 * included — and signals are addressed to one socket. A stage replaced by a newer window of the
 * same account stops for good (`replaced`).
 *
 * REQ-242 — the customer's screen rides the same link as `dom` chunks (the reliable channel, or
 * the relay); a stage's `resync` goes to the customer alone — colleagues get pointers only.
 */
import {
  type ClientMessage,
  parsePeerMessage,
  parseServerMessage,
  type PeerMessage,
  PRESENCE_GRACE_MS,
  type Role,
  SOCKET_PATH,
} from "../../../shared/demo-mode/protocol.ts";

export type LinkStatus =
  | "connecting"
  | "waiting"
  | "relay"
  | "direct"
  | "ended"
  | "closed"
  /** REQ-232 — the same staff account opened the demo in a newer window */
  | "replaced";

/** REQ-214 — who a message came from: the viewer, or a presenter by pid; REQ-232 — and which socket */
export interface PeerFrom {
  role: Role;
  pid?: string;
  cid?: string;
}

export interface DemoLinkOptions {
  sessionId: string;
  role: Role;
  /** REQ-214 — this presenter's own id (a presenter only) */
  pid?: string;
  onPeer(m: PeerMessage, from: PeerFrom): void;
  onStatus(s: LinkStatus): void;
  /** the other side arrived (or was there on welcome); REQ-232 — on the customer's side also: a
   *  stage asks this tab for its whole view (it follows this tab now); on a stage: it follows
   *  another of the customer's tabs */
  onPeerOnline(): void;
  /** REQ-214 — a presenter came or went (on the customer's side: any of them; on a stage: a
   *  colleague) — per account: the first window of theirs to come, the last to go */
  onPresence?(pid: string, online: boolean): void;
  /** REQ-235 — `pid`: the presenter who ended it (none when the viewer did) */
  onEnded(by: Role, reason?: "declined", pid?: string): void;
}

export interface DemoLink {
  /** `lossy` — a pointer move: dropped rather than queued when the channel is behind */
  send(m: PeerMessage, lossy?: boolean): void;
  isDirect(): boolean;
  /** REQ-232 — the customer's side: this tab is the one the customer is using now */
  claim(): void;
  /** end the demo for both sides */
  end(): void;
  close(): void;
}

const ICE: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};
const MAX_ATTEMPTS = 5;
/** REQ-242 — what a presenter's colleagues see of it: its pointer, never its resyncs */
const isPointer = (m: PeerMessage) =>
  m.k === "move" || m.k === "click" || m.k === "leave";
/** a far socket the server did not name (a message from before REQ-232) */
const NO_CID = "";

type Signal = {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

/** one WebRTC connection and its two channels; `pid`: the presenter on the far side (the customer's) */
interface Conn {
  pc: RTCPeerConnection;
  lossy: RTCDataChannel | null;
  reliable: RTCDataChannel | null;
  pid?: string;
}

/** REQ-232 — a customer tab as a stage knows it: when it last claimed (its own clock; 0 never)
 *  and the order it arrived in */
interface Tab {
  at: number;
  n: number;
}

export function connectDemo(o: DemoLinkOptions): DemoLink {
  let ws: WebSocket | null = null;
  /** by far socket (cid): a presenter's one connection is to the tab it follows; the customer's
   *  are one per stage */
  const conns = new Map<string, Conn>();
  /** REQ-232 — a presenter: the customer's tabs online, by cid */
  const tabs = new Map<string, Tab>();
  let arrivals = 0;
  /** REQ-232 — a presenter: the tab it follows (null: none) */
  let followed: string | null = null;
  /** REQ-232 — tabs that left: a late claim never brings one back */
  const gone = new Set<string>();
  /** REQ-214/232 — the stages online, cid → pid: the customer's presenters, a presenter's colleagues */
  const stages = new Map<string, string>();
  /** REQ-232 — the customer's side: when this tab last claimed the stage (0: never) */
  let claimedAt = 0;
  /** REQ-232 — the other side's last socket went a moment ago: still "live" until the grace ends */
  let lingering = false;
  let grace: number | undefined;
  let closed = false;
  let ended = false;
  let replaced = false;
  let attempt = 0;
  let status: LinkStatus = "connecting";
  let retry: number | undefined;

  const setStatus = (s: LinkStatus) => {
    if (status === s) return;
    status = s;
    o.onStatus(s);
  };
  const wsSend = (m: ClientMessage) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };
  const open = (c: Conn | undefined) =>
    c?.reliable?.readyState === "open" && c?.lossy?.readyState === "open";
  /** every connection this side should have is open */
  const direct = () => {
    if (o.role === "presenter") {
      return followed !== null && open(conns.get(followed));
    }
    return stages.size > 0 &&
      [...stages.keys()].every((c) => open(conns.get(c)));
  };
  /** the other side is here: a tab (a presenter), a stage (the customer), or was a moment ago */
  const online = () =>
    (o.role === "presenter" ? tabs.size : stages.size) > 0 || lingering;
  const refresh = () => {
    if (ended) return setStatus("ended");
    if (replaced) return setStatus("replaced");
    if (closed) return setStatus("closed");
    if (ws?.readyState !== WebSocket.OPEN) return setStatus("connecting");
    if (!online()) return setStatus("waiting");
    setStatus(direct() ? "direct" : "relay");
  };
  const endGrace = () => {
    lingering = false;
    clearTimeout(grace);
  };
  /** REQ-232 — the last socket of the other side went: hold "live" for the grace */
  const startGrace = () => {
    lingering = true;
    clearTimeout(grace);
    grace = setTimeout(() => {
      lingering = false;
      refresh();
    }, PRESENCE_GRACE_MS);
  };

  const teardown = (key: string) => {
    const c = conns.get(key);
    if (!c) return;
    conns.delete(key);
    try {
      c.lossy?.close();
      c.reliable?.close();
      c.pc.close();
    } catch { /* already closed */ }
  };
  const teardownAll = () => {
    for (const key of [...conns.keys()]) teardown(key);
  };

  /** the far side of a connection: a customer's tab for a presenter, a stage for the customer */
  const farSide = (key: string): PeerFrom => {
    if (o.role === "presenter") {
      return key === NO_CID ? { role: "viewer" } : { role: "viewer", cid: key };
    }
    const pid = conns.get(key)?.pid ?? stages.get(key);
    return {
      role: "presenter",
      ...(pid ? { pid } : {}),
      ...(key === NO_CID ? {} : { cid: key }),
    };
  };
  /** a message for the app — REQ-232: on a stage, only the followed tab's */
  const take = (m: PeerMessage, from: PeerFrom) => {
    if (
      o.role === "presenter" && from.role === "viewer" &&
      (from.cid ?? NO_CID) !== (followed ?? NO_CID)
    ) return;
    o.onPeer(m, from);
  };
  const wire = (ch: RTCDataChannel, key: string) => {
    ch.onopen = refresh;
    ch.onclose = refresh;
    ch.onmessage = (e) => {
      try {
        const m = parsePeerMessage(JSON.parse(String(e.data)));
        if (m) take(m, farSide(key));
      } catch { /* not ours */ }
    };
  };
  /** a signal's address: the one socket it is for */
  const signalTo = (key: string) => key === NO_CID ? {} : { to: key };

  const newConn = (key: string, pid?: string): Conn | null => {
    teardown(key);
    if (typeof RTCPeerConnection === "undefined") return null;
    const pc = new RTCPeerConnection(ICE);
    const c: Conn = {
      pc,
      lossy: null,
      reliable: null,
      ...(pid ? { pid } : {}),
    };
    conns.set(key, c);
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        wsSend({
          t: "signal",
          data: { candidate: e.candidate.toJSON() } satisfies Signal,
          ...signalTo(key),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (
        conns.get(key) === c &&
        (pc.connectionState === "failed" || pc.connectionState === "closed")
      ) {
        teardown(key);
        refresh();
      }
    };
    pc.ondatachannel = (e) => {
      if (e.channel.label === "lossy") c.lossy = e.channel;
      else c.reliable = e.channel;
      wire(e.channel, key);
    };
    return c;
  };

  /** a presenter offers the tab it follows a connection */
  const offer = async (key: string) => {
    const c = newConn(key);
    if (!c) return;
    c.lossy = c.pc.createDataChannel("lossy", {
      ordered: false,
      maxRetransmits: 0,
    });
    c.reliable = c.pc.createDataChannel("reliable");
    wire(c.lossy, key);
    wire(c.reliable, key);
    try {
      await c.pc.setLocalDescription(await c.pc.createOffer());
      if (conns.get(key) === c && c.pc.localDescription) {
        wsSend({
          t: "signal",
          data: {
            description: c.pc.localDescription.toJSON(),
          } satisfies Signal,
          ...signalTo(key),
        });
      }
    } catch {
      teardown(key);
      refresh();
    }
  };

  /** REQ-232 — the tab to follow: the one claimed last, else the one that arrived last. A switch
   *  hides the old tab's pointer, asks the new tab for its whole view and offers it a connection */
  const follow = () => {
    let best: string | null = null;
    let top: Tab | null = null;
    for (const [cid, t] of tabs) {
      if (!top || t.at > top.at || (t.at === top.at && t.n > top.n)) {
        best = cid;
        top = t;
      }
    }
    if (best === followed) return;
    const was = followed;
    if (was !== null) {
      teardown(was);
      o.onPeer({ k: "leave" }, { role: "viewer", cid: was });
    }
    followed = best;
    if (best === null) return;
    wsSend({ t: "sync", to: best });
    void offer(best);
    o.onPeerOnline();
  };
  /** REQ-232 — a presenter: a customer's tab came, went or claimed */
  const tabSeen = (cid: string, at = 0) => {
    if (gone.has(cid)) return;
    const t = tabs.get(cid);
    if (t) t.at = Math.max(t.at, at);
    else tabs.set(cid, { at, n: ++arrivals });
    endGrace();
    follow();
    refresh();
  };
  const tabLeft = (cid: string) => {
    gone.add(cid);
    if (gone.size > 200) gone.delete(gone.values().next().value!);
    if (!tabs.delete(cid)) return;
    if (tabs.size === 0) startGrace();
    follow();
    refresh();
  };
  /** REQ-232 — the customer's side: say again that this tab is the one in use */
  const reclaim = () => {
    if (claimedAt > 0) wsSend({ t: "claim", at: claimedAt });
  };
  const hasPid = (pid: string) => [...stages.values()].includes(pid);
  /** REQ-214/232 — a stage came or went (by cid; a presenter dropped from the demo: all of theirs) */
  const stageSeen = (online: boolean, pid: string, cid?: string) => {
    // a presenter's own account in another window is never a colleague (the newer one replaces it)
    if (o.role === "presenter" && pid === o.pid) return;
    const had = hasPid(pid);
    let fresh = false;
    if (online) {
      const key = cid ?? pid;
      fresh = !stages.has(key);
      stages.set(key, pid);
    } else {
      for (const [key, p] of [...stages]) {
        if (cid !== undefined ? key === cid : p === pid) {
          stages.delete(key);
          teardown(key);
        }
      }
    }
    if (hasPid(pid) !== had) o.onPresence?.(pid, !had);
    if (o.role !== "viewer") return;
    if (online) endGrace();
    else if (stages.size === 0) startGrace();
    refresh();
    if (online && fresh) {
      reclaim();
      o.onPeerOnline();
    }
  };

  const onSignal = async (data: unknown, from: PeerFrom) => {
    const d = (data ?? {}) as Signal;
    const key = from.cid ?? NO_CID;
    try {
      if (d.description?.type === "offer") {
        // the customer: a stage offers this tab a connection — one per stage
        if (o.role !== "viewer") return;
        const c = newConn(key, from.pid);
        if (!c) return;
        await c.pc.setRemoteDescription(d.description);
        await c.pc.setLocalDescription(await c.pc.createAnswer());
        if (conns.get(key) === c && c.pc.localDescription) {
          wsSend({
            t: "signal",
            data: {
              description: c.pc.localDescription.toJSON(),
            } satisfies Signal,
            ...signalTo(key),
          });
        }
      } else {
        // an answer or a candidate for a connection this side made (a stage: only the followed tab's)
        const c = conns.get(key);
        if (d.description && c) await c.pc.setRemoteDescription(d.description);
        else if (d.candidate && c) await c.pc.addIceCandidate(d.candidate);
      }
    } catch {
      // a stale or malformed signal: the relay carries on
    }
  };

  const openSocket = () => {
    if (closed || ended || replaced) return;
    const proto = globalThis.location.protocol === "https:" ? "wss" : "ws";
    const sock = new WebSocket(
      `${proto}://${globalThis.location.host}${SOCKET_PATH}?session=${
        encodeURIComponent(o.sessionId)
      }`,
    );
    ws = sock;
    sock.onopen = () => {
      attempt = 0;
      refresh();
    };
    sock.onmessage = (e) => {
      const m = parseServerMessage(String(e.data));
      if (!m) return;
      switch (m.t) {
        case "welcome":
          // who is here comes next, one `peer` each (REQ-232); this tab says again it is in use
          reclaim();
          refresh();
          break;
        case "peer":
          if (m.pid !== undefined) stageSeen(m.online, m.pid, m.cid);
          else if (o.role === "presenter") {
            if (m.online) tabSeen(m.cid ?? NO_CID);
            else tabLeft(m.cid ?? NO_CID);
          }
          break;
        case "claim":
          if (o.role === "presenter") tabSeen(m.cid, m.at);
          break;
        case "sync":
          if (o.role === "viewer") o.onPeerOnline();
          break;
        case "signal":
          void onSignal(m.data, { role: m.from, pid: m.pid, cid: m.cid });
          break;
        case "relay":
          take(m.data, {
            role: m.from,
            ...(m.pid ? { pid: m.pid } : {}),
            ...(m.cid ? { cid: m.cid } : {}),
          });
          break;
        case "replaced":
          replaced = true;
          teardownAll();
          refresh();
          sock.close();
          break;
        case "ended":
          ended = true;
          teardownAll();
          refresh();
          o.onEnded(m.by, m.reason, m.pid);
          sock.close();
          break;
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      teardownAll();
      tabs.clear();
      followed = null;
      stages.clear();
      endGrace();
      if (closed || ended || replaced) return refresh();
      if (attempt >= MAX_ATTEMPTS) {
        closed = true;
        return refresh();
      }
      const delay = Math.min(8000, 1000 * 2 ** attempt++);
      setStatus("connecting");
      retry = setTimeout(openSocket, delay);
    };
    sock.onerror = () => {/* onclose follows */};
  };

  openSocket();

  const sendOn = (c: Conn, m: PeerMessage, lossyOk: boolean) => {
    (lossyOk ? c.lossy : c.reliable)!.send(JSON.stringify(m));
  };

  return {
    send(m, lossyOk = false) {
      if (o.role === "presenter") {
        // REQ-214 — the colleagues see this pointer through the relay
        if (stages.size > 0 && isPointer(m)) {
          wsSend({ t: "relay", data: m, to: "presenters" });
        }
        const c = followed === null ? undefined : conns.get(followed);
        if (open(c)) {
          try {
            sendOn(c!, m, lossyOk);
            return;
          } catch { /* fall through to the relay */ }
        }
        wsSend({ t: "relay", data: m });
        return;
      }
      if (direct()) {
        try {
          for (const cid of stages.keys()) sendOn(conns.get(cid)!, m, lossyOk);
          return;
        } catch {
          /* fall through to the relay, which reaches every presenter */
        }
      }
      wsSend({ t: "relay", data: m });
    },
    isDirect: () => Boolean(direct()),
    claim() {
      if (o.role !== "viewer") return;
      claimedAt = Date.now();
      wsSend({ t: "claim", at: claimedAt });
    },
    end() {
      wsSend({ t: "end" });
    },
    close() {
      closed = true;
      clearTimeout(retry);
      endGrace();
      teardownAll();
      const sock = ws;
      ws = null;
      try {
        sock?.close();
      } catch { /* already closed */ }
    },
  };
}
