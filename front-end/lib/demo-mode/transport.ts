/**
 * REQ-153 — one demo link: the WebSocket to the deploy (signaling, presence, and the relay) and,
 * on top of it, WebRTC peer connections the presenters offer — STUN only, no TURN — with an
 * unreliable data channel for pointer moves and a reliable one for clicks and routes. A message
 * rides the data channels when they are open and the WebSocket relay otherwise; `status` says
 * which. The socket reconnects with backoff; a refused socket (the demo ended, the session is
 * nobody in it) ends in `closed` so the overlay can ask `active` again.
 *
 * REQ-214 — several presenters: a presenter holds ONE connection, to the customer; the
 * customer holds one PER presenter (keyed by pid — the offer says who it is from, the answer
 * is addressed back). The customer's message goes to every presenter (on every channel when
 * all are open, else through the relay); a presenter's goes to the customer on the channel or
 * the relay AND to the other presenters through the relay (`to: "presenters"`), so every stage
 * shows the colleagues' pointers. `onPeer` says who a message is from.
 */
import {
  type ClientMessage,
  parsePeerMessage,
  parseServerMessage,
  type PeerMessage,
  type Role,
  SOCKET_PATH,
} from "../../../shared/demo-mode/protocol.ts";

export type LinkStatus =
  | "connecting"
  | "waiting"
  | "relay"
  | "direct"
  | "ended"
  | "closed";

/** REQ-214 — who a message came from: the viewer, or a presenter by pid */
export interface PeerFrom {
  role: Role;
  pid?: string;
}

export interface DemoLinkOptions {
  sessionId: string;
  role: Role;
  /** REQ-214 — this presenter's own id (a presenter only) */
  pid?: string;
  onPeer(m: PeerMessage, from: PeerFrom): void;
  onStatus(s: LinkStatus): void;
  /** the other side arrived (or was there on welcome) */
  onPeerOnline(): void;
  /** REQ-214 — a presenter came or went (on the customer's side: any of them; on a stage: a colleague) */
  onPresence?(pid: string, online: boolean): void;
  onEnded(by: Role, reason?: "declined"): void;
}

export interface DemoLink {
  /** `lossy` — a pointer move: dropped rather than queued when the channel is behind */
  send(m: PeerMessage, lossy?: boolean): void;
  isDirect(): boolean;
  /** end the demo for both sides */
  end(): void;
  close(): void;
}

const ICE: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};
const MAX_ATTEMPTS = 5;
/** the customer's connection to a presenter whose offer carried no pid (a demo written before the list) */
const NO_PID = "";

type Signal = {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

/** one WebRTC connection and its two channels */
interface Conn {
  pc: RTCPeerConnection;
  lossy: RTCDataChannel | null;
  reliable: RTCDataChannel | null;
}

export function connectDemo(o: DemoLinkOptions): DemoLink {
  let ws: WebSocket | null = null;
  /** the presenter's one connection lives under NO_PID; the customer's are by presenter pid */
  const conns = new Map<string, Conn>();
  /** REQ-214 — the presenters the customer knows to be online (the viewer only) */
  const presenters = new Set<string>();
  /** REQ-214 — the colleagues a presenter knows to be online */
  const colleagues = new Set<string>();
  let peerOnline = false;
  let closed = false;
  let ended = false;
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
    if (o.role === "presenter") return open(conns.get(NO_PID));
    const want = presenters.size > 0 ? [...presenters] : [];
    return want.length > 0 && want.every((pid) => open(conns.get(pid)));
  };
  const refresh = () => {
    if (ended) return setStatus("ended");
    if (closed) return setStatus("closed");
    if (ws?.readyState !== WebSocket.OPEN) return setStatus("connecting");
    if (!peerOnline) return setStatus("waiting");
    setStatus(direct() ? "direct" : "relay");
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

  const wire = (ch: RTCDataChannel, from: PeerFrom) => {
    ch.onopen = refresh;
    ch.onclose = refresh;
    ch.onmessage = (e) => {
      try {
        const m = parsePeerMessage(JSON.parse(String(e.data)));
        if (m) o.onPeer(m, from);
      } catch { /* not ours */ }
    };
  };

  /** the far side of a connection keyed `key`: the customer for a presenter, a presenter for the customer */
  const farSide = (key: string): PeerFrom =>
    o.role === "presenter"
      ? { role: "viewer" }
      : key === NO_PID
      ? { role: "presenter" }
      : { role: "presenter", pid: key };
  /** the signal's address: the customer answers the presenter it is for */
  const signalTo = (key: string) =>
    o.role === "viewer" && key !== NO_PID ? { to: key } : {};

  const newConn = (key: string): Conn | null => {
    teardown(key);
    if (typeof RTCPeerConnection === "undefined") return null;
    const pc = new RTCPeerConnection(ICE);
    const c: Conn = { pc, lossy: null, reliable: null };
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
      wire(e.channel, farSide(key));
    };
    return c;
  };

  /** the presenter offers the customer a connection */
  const offer = async () => {
    const c = newConn(NO_PID);
    if (!c) return;
    c.lossy = c.pc.createDataChannel("lossy", {
      ordered: false,
      maxRetransmits: 0,
    });
    c.reliable = c.pc.createDataChannel("reliable");
    wire(c.lossy, farSide(NO_PID));
    wire(c.reliable, farSide(NO_PID));
    try {
      await c.pc.setLocalDescription(await c.pc.createOffer());
      if (conns.get(NO_PID) === c && c.pc.localDescription) {
        wsSend({
          t: "signal",
          data: {
            description: c.pc.localDescription.toJSON(),
          } satisfies Signal,
        });
      }
    } catch {
      teardown(NO_PID);
      refresh();
    }
  };

  const onSignal = async (data: unknown, from: PeerFrom) => {
    const d = (data ?? {}) as Signal;
    // the customer keeps one connection per presenter; a presenter has the one
    const key = o.role === "viewer" ? from.pid ?? NO_PID : NO_PID;
    try {
      if (d.description?.type === "offer") {
        const c = newConn(key);
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
        const c = conns.get(key);
        if (d.description && c) await c.pc.setRemoteDescription(d.description);
        else if (d.candidate && c) await c.pc.addIceCandidate(d.candidate);
      }
    } catch {
      // a stale or malformed signal: the relay carries on
    }
  };

  const openSocket = () => {
    if (closed || ended) return;
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
          peerOnline = m.peerOnline;
          refresh();
          if (peerOnline) {
            o.onPeerOnline();
            if (o.role === "presenter") void offer();
          }
          break;
        case "peer":
          if (m.pid !== undefined && o.role === "presenter") {
            // REQ-214 — a colleague came or went: the customer's presence is unchanged
            if (m.online) colleagues.add(m.pid);
            else colleagues.delete(m.pid);
            o.onPresence?.(m.pid, m.online);
            break;
          }
          if (m.pid !== undefined) {
            // the customer: a presenter came or went; online while any is
            if (m.online) presenters.add(m.pid);
            else {
              presenters.delete(m.pid);
              teardown(m.pid);
            }
            o.onPresence?.(m.pid, m.online);
            const was = peerOnline;
            peerOnline = presenters.size > 0;
            refresh();
            if (peerOnline && (!was || m.online)) o.onPeerOnline();
            break;
          }
          peerOnline = m.online;
          if (!m.online) teardownAll();
          refresh();
          if (m.online) {
            o.onPeerOnline();
            if (o.role === "presenter") void offer();
          }
          break;
        case "signal":
          void onSignal(m.data, { role: m.from, pid: m.pid });
          break;
        case "relay":
          o.onPeer(m.data, { role: m.from, pid: m.pid });
          break;
        case "ended":
          ended = true;
          teardownAll();
          refresh();
          o.onEnded(m.by, m.reason);
          sock.close();
          break;
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      teardownAll();
      presenters.clear();
      colleagues.clear();
      peerOnline = false;
      if (closed || ended) return refresh();
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
        if (colleagues.size > 0 && m.k !== "view") {
          wsSend({ t: "relay", data: m, to: "presenters" });
        }
        const c = conns.get(NO_PID);
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
          for (const pid of presenters) sendOn(conns.get(pid)!, m, lossyOk);
          return;
        } catch {
          /* fall through to the relay, which reaches every presenter */
        }
      }
      wsSend({ t: "relay", data: m });
    },
    isDirect: () => Boolean(direct()),
    end() {
      wsSend({ t: "end" });
    },
    close() {
      closed = true;
      clearTimeout(retry);
      teardownAll();
      const sock = ws;
      ws = null;
      try {
        sock?.close();
      } catch { /* already closed */ }
    },
  };
}
