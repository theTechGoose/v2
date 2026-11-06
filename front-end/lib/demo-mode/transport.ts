/**
 * REQ-153 — one demo link: the WebSocket to the deploy (signaling, presence, and the relay) and,
 * on top of it, a WebRTC peer connection the presenter offers — STUN only, no TURN — with an
 * unreliable data channel for pointer moves and a reliable one for clicks and routes. A message
 * rides the data channels when both are open and the WebSocket relay otherwise; `status` says
 * which. The socket reconnects with backoff; a refused socket (the demo ended, the session is
 * nobody in it) ends in `closed` so the overlay can ask `active` again.
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

export interface DemoLinkOptions {
  sessionId: string;
  role: Role;
  onPeer(m: PeerMessage): void;
  onStatus(s: LinkStatus): void;
  /** the other side arrived (or was there on welcome) */
  onPeerOnline(): void;
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

type Signal = {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export function connectDemo(o: DemoLinkOptions): DemoLink {
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let lossy: RTCDataChannel | null = null;
  let reliable: RTCDataChannel | null = null;
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
  const direct = () =>
    reliable?.readyState === "open" && lossy?.readyState === "open";
  const refresh = () => {
    if (ended) return setStatus("ended");
    if (closed) return setStatus("closed");
    if (ws?.readyState !== WebSocket.OPEN) return setStatus("connecting");
    if (!peerOnline) return setStatus("waiting");
    setStatus(direct() ? "direct" : "relay");
  };

  const teardownPc = () => {
    try {
      lossy?.close();
      reliable?.close();
      pc?.close();
    } catch { /* already closed */ }
    pc = lossy = reliable = null;
  };

  const wire = (ch: RTCDataChannel) => {
    ch.onopen = refresh;
    ch.onclose = refresh;
    ch.onmessage = (e) => {
      try {
        const m = parsePeerMessage(JSON.parse(String(e.data)));
        if (m) o.onPeer(m);
      } catch { /* not ours */ }
    };
  };

  const newPc = (): RTCPeerConnection | null => {
    teardownPc();
    if (typeof RTCPeerConnection === "undefined") return null;
    const p = new RTCPeerConnection(ICE);
    pc = p;
    p.onicecandidate = (e) => {
      if (e.candidate) {
        wsSend({
          t: "signal",
          data: { candidate: e.candidate.toJSON() } satisfies Signal,
        });
      }
    };
    p.onconnectionstatechange = () => {
      if (
        pc === p &&
        (p.connectionState === "failed" || p.connectionState === "closed")
      ) {
        teardownPc();
        refresh();
      }
    };
    p.ondatachannel = (e) => {
      if (e.channel.label === "lossy") lossy = e.channel;
      else reliable = e.channel;
      wire(e.channel);
    };
    return p;
  };

  const offer = async () => {
    const p = newPc();
    if (!p) return;
    lossy = p.createDataChannel("lossy", { ordered: false, maxRetransmits: 0 });
    reliable = p.createDataChannel("reliable");
    wire(lossy);
    wire(reliable);
    try {
      await p.setLocalDescription(await p.createOffer());
      if (pc === p && p.localDescription) {
        wsSend({
          t: "signal",
          data: { description: p.localDescription.toJSON() } satisfies Signal,
        });
      }
    } catch {
      teardownPc();
      refresh();
    }
  };

  const onSignal = async (data: unknown) => {
    const d = (data ?? {}) as Signal;
    try {
      if (d.description?.type === "offer") {
        const p = newPc();
        if (!p) return;
        await p.setRemoteDescription(d.description);
        await p.setLocalDescription(await p.createAnswer());
        if (pc === p && p.localDescription) {
          wsSend({
            t: "signal",
            data: { description: p.localDescription.toJSON() } satisfies Signal,
          });
        }
      } else if (d.description && pc) {
        await pc.setRemoteDescription(d.description);
      } else if (d.candidate && pc) {
        await pc.addIceCandidate(d.candidate);
      }
    } catch {
      // a stale or malformed signal: the relay carries on
    }
  };

  const open = () => {
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
          peerOnline = m.online;
          if (!m.online) teardownPc();
          refresh();
          if (m.online) {
            o.onPeerOnline();
            if (o.role === "presenter") void offer();
          }
          break;
        case "signal":
          void onSignal(m.data);
          break;
        case "relay":
          o.onPeer(m.data);
          break;
        case "ended":
          ended = true;
          teardownPc();
          refresh();
          o.onEnded(m.by, m.reason);
          sock.close();
          break;
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      teardownPc();
      peerOnline = false;
      if (closed || ended) return refresh();
      if (attempt >= MAX_ATTEMPTS) {
        closed = true;
        return refresh();
      }
      const delay = Math.min(8000, 1000 * 2 ** attempt++);
      setStatus("connecting");
      retry = setTimeout(open, delay);
    };
    sock.onerror = () => {/* onclose follows */};
  };

  open();

  return {
    send(m, lossyOk = false) {
      if (direct()) {
        try {
          (lossyOk ? lossy : reliable)!.send(JSON.stringify(m));
          return;
        } catch { /* fall through to the relay */ }
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
      teardownPc();
      const sock = ws;
      ws = null;
      try {
        sock?.close();
      } catch { /* already closed */ }
    },
  };
}
