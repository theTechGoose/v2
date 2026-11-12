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
 *
 * REQ-391 (demo-loop cycle 2, M4 + m21) — a customer tab says WHY its page goes (`leaving`, on
 * the socket, at pagehide) and the server stamps it on the tab's departure. A stage whose last tab
 * went says so at once: "closing" — waiting, no grace; "navigating" — "between" for
 * PRESENCE_GRACE_MS while the next page comes; nothing said (a crash, a lost network, a page from
 * before) — "between" for SILENT_GRACE_MS. Never "live" over a page that is gone. Every link also
 * asks the deploy's time once welcomed (`time`) and keeps the best round trip's offset: `now()` is
 * the deploy's clock as this browser knows it, the same on both ends within a round trip — the
 * mirror stamps frames with it and the stage measures how late they come in.
 *
 * REQ-436 (demo-loop cycle 3, M2/M2b/M2c/M5) — a stage follows BROWSER TABS, not sockets. Every
 * page of one browser tab carries the same key (`tab`, kept in sessionStorage by the overlay) on
 * its claims, and says it on every welcome (`at` 0 when the page never claimed); a claim also
 * says whether the page has focus (`f`), which wins a tie. When the followed tab's page goes
 * NAVIGATING, the stage keeps following that browser tab — "between", no other tab synced, sent
 * a `leave` or handed the presenter's pointer — for PRESENCE_GRACE_MS: its next page takes the
 * stage back the moment it names the key. Another tab is followed only when the grace ends, when
 * the page said it is closing (or said nothing), or when another tab is really claimed since.
 *
 * REQ-648 (demo-loop cycle 5, M3 + c4-m28) — a stage hears when the page it follows went
 * (`onPageGone`): the server's stamp of the page's `leaving` (on the deploy's clock), or this
 * link's own `now()` when the page said nothing. Not for a page CLOSING — no next page is coming.
 * The stage times the page change from it to the next page on show. And every link asks the
 * deploy's time again after its welcome (TIME_AGAIN_MS): the customer's link now starts while its
 * page is still loading (early-link.ts), when an answer can sit behind the page's own work — a
 * round trip that long skews the clock by half of it, and the stage read every frame as late; the
 * quickest round trip still wins.
 */
import {
  type ClientMessage,
  type LeaveWhy,
  parsePeerMessage,
  parseServerMessage,
  type PeerMessage,
  PRESENCE_GRACE_MS,
  type Role,
  SILENT_GRACE_MS,
  SOCKET_PATH,
} from "../../../shared/demo-mode/protocol.ts";

/** REQ-648 — after its welcome a link asks the deploy's time again this long after it (ms) */
export const TIME_AGAIN_MS = [1_500, 5_000, 15_000];

export type LinkStatus =
  | "connecting"
  | "waiting"
  /** REQ-391 — a stage: the customer's page went and its next one may still come (the grace) */
  | "between"
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
  /** REQ-436 — the customer's side: this browser tab's key, the same on every page of the tab */
  tab?: string;
  /** REQ-436 — the customer's side: does this page have focus (said on every claim) */
  hasFocus?: () => boolean;
  onPeer(m: PeerMessage, from: PeerFrom): void;
  onStatus(s: LinkStatus): void;
  /** the other side arrived (or was there on welcome); REQ-232 — on the customer's side also: a
   *  stage asks this tab for its whole view (it follows this tab now); on a stage: it follows
   *  another of the customer's tabs — `cid` names it (REQ-292: the stage starts its mirror over
   *  when it changes) */
  onPeerOnline(cid?: string): void;
  /** REQ-214 — a presenter came or went (on the customer's side: any of them; on a stage: a
   *  colleague) — per account: the first window of theirs to come, the last to go */
  onPresence?(pid: string, online: boolean): void;
  /** REQ-235 — `pid`: the presenter who ended it (none when the viewer did) */
  onEnded(by: Role, reason?: "declined" | "expired", pid?: string): void;
  /** REQ-648 — a stage: the page of the followed tab went (not closing) — `at`: when it said so,
   *  on the deploy's clock (this link's `now()` when it said nothing); `why`: what it said */
  onPageGone?(at: number, why?: LeaveWhy): void;
}

export interface DemoLink {
  /** `lossy` — a pointer move: dropped rather than queued when the channel is behind */
  send(m: PeerMessage, lossy?: boolean): void;
  isDirect(): boolean;
  /** REQ-232 — the customer's side: this tab is the one the customer is using now */
  claim(): void;
  /** REQ-391 — this page is going, and why (at pagehide): the server says it when the socket goes */
  leaving(why: LeaveWhy): void;
  /** REQ-391 — the deploy's clock as this browser knows it (its own until the deploy answered) */
  now(): number;
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
  /** REQ-436 — its browser tab's key, once a claim said it */
  key?: string;
  /** REQ-436 — its last claim said its page has focus */
  f?: boolean;
}

/** REQ-436 — a browser tab whose followed page went navigating: the stage holds on to it */
interface Held {
  key: string;
  at: number;
  f?: boolean;
  timer: ReturnType<typeof setTimeout>;
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
  /** REQ-436 — a presenter: the followed browser tab is between two pages (null: it is not) */
  let held: Held | null = null;
  /** REQ-232 — tabs that left: a late claim never brings one back */
  const gone = new Set<string>();
  /** REQ-214/232 — the stages online, cid → pid: the customer's presenters, a presenter's colleagues */
  const stages = new Map<string, string>();
  /** REQ-232 — the customer's side: when this tab last claimed the stage (0: never) */
  let claimedAt = 0;
  /** REQ-232 — the other side's last socket went a moment ago: still "live" until the grace ends */
  let lingering = false;
  let grace: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let ended = false;
  let replaced = false;
  let attempt = 0;
  let status: LinkStatus = "connecting";
  let retry: ReturnType<typeof setTimeout> | undefined;
  /** REQ-391 — the deploy's clock minus this browser's, from the shortest `time` round trip */
  let skew = 0;
  let bestRtt = Number.POSITIVE_INFINITY;

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
    // REQ-391 — a stage whose customer's page went: never "live" over it while the next may come
    if (o.role === "presenter" && (tabs.size === 0 || held)) {
      return setStatus("between");
    }
    setStatus(direct() ? "direct" : "relay");
  };
  const endGrace = () => {
    lingering = false;
    clearTimeout(grace);
  };
  /** REQ-232 — the last socket of the other side went: hold on for the grace (REQ-391 — how long
   *  depends on what its page said: PRESENCE_GRACE_MS by default) */
  const startGrace = (ms: number = PRESENCE_GRACE_MS) => {
    lingering = true;
    clearTimeout(grace);
    grace = setTimeout(() => {
      lingering = false;
      refresh();
    }, ms);
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
   *  hides the old tab's pointer, asks the new tab for its whole view and offers it a connection.
   *  REQ-393 — and tells the tab it left (still open) to take this presenter's pointer away: it
   *  kept the last one, and showed it again, stale, when the customer came back to it */
  const follow = () => {
    let best: string | null = null;
    let top: Tab | null = null;
    // REQ-436 — a tie on the claim's time goes to the page that has focus, then the newest
    const beats = (t: Tab, u: Tab) =>
      t.at > u.at ||
      (t.at === u.at && (!!t.f !== !!u.f ? !!t.f : t.n > u.n));
    for (const [cid, t] of tabs) {
      if (!top || beats(t, top)) {
        best = cid;
        top = t;
      }
    }
    // REQ-436 — the followed browser tab is between pages: it keeps the stage unless another tab
    // was claimed since (the customer really went there)
    if (held) {
      if (!top || top.at <= held.at) return;
      release();
    }
    if (best === followed) return;
    const was = followed;
    if (was !== null) {
      if (was !== NO_CID && !gone.has(was)) {
        wsSend({ t: "relay", data: { k: "leave" }, tab: was });
      }
      teardown(was);
      o.onPeer({ k: "leave" }, { role: "viewer", cid: was });
    }
    followed = best;
    if (best === null) return;
    wsSend({ t: "sync", to: best });
    void offer(best);
    o.onPeerOnline(best);
  };
  /** REQ-436 — the held browser tab is no longer between pages (its page came, or it is over) */
  const release = () => {
    if (!held) return;
    clearTimeout(held.timer);
    held = null;
  };
  /** REQ-436 — a page of browser tab `key` is here: it takes over what the tab's earlier page had
   *  (its claim; the stage, when the tab was held) */
  const inherit = (t: Tab, key: string, at: number, f?: boolean) => {
    if (at >= t.at) {
      t.at = at;
      t.f = f;
    }
    t.key = key;
  };
  /** REQ-232 — a presenter: a customer's tab came, went or claimed (REQ-436 — `key`: its browser
   *  tab, `f`: its page has focus) */
  const tabSeen = (cid: string, at = 0, key?: string, f?: boolean) => {
    if (gone.has(cid)) return;
    let t = tabs.get(cid);
    if (!t) tabs.set(cid, t = { at: 0, n: ++arrivals });
    if (at >= t.at && (at > 0 || key)) {
      t.at = at;
      t.f = f;
    }
    if (key) {
      t.key = key;
      if (held?.key === key) {
        // the followed browser tab's next page: the stage goes back to it at once
        const h = held;
        release();
        inherit(t, key, h.at, h.f);
      }
    }
    endGrace();
    follow();
    refresh();
  };
  /** REQ-391 — `why`: what its page said as it went. The last tab gone: closing — nobody to wait
   *  for (waiting at once, m21); navigating — its next page comes (the full grace, M4); nothing
   *  said — a short grace */
  const tabLeft = (cid: string, why?: LeaveWhy, at?: number) => {
    gone.add(cid);
    if (gone.size > 200) gone.delete(gone.values().next().value!);
    const t = tabs.get(cid);
    if (!tabs.delete(cid)) return;
    // REQ-648 — the followed page went and a next one may come: the stage times the change
    if (cid === followed && why !== "closing") {
      o.onPageGone?.(at ?? Date.now() + skew, why);
    }
    if (cid === followed && t?.key) {
      // REQ-436 — a page of the same browser tab is already here: it is the stage's now
      const next = [...tabs.values()].find((u) => u.key === t.key);
      if (next) inherit(next, t.key, t.at, t.f);
      else if (why === "navigating") {
        // its next page is coming: keep following this browser tab, "between", for the grace —
        // the page that went takes its connection and its pointer along
        teardown(cid);
        o.onPeer({ k: "leave" }, { role: "viewer", cid });
        release();
        held = {
          key: t.key,
          at: t.at,
          f: t.f,
          timer: setTimeout(() => {
            held = null;
            follow();
            refresh();
          }, PRESENCE_GRACE_MS),
        };
      }
    }
    if (tabs.size === 0) {
      const ms = why === "navigating" ? PRESENCE_GRACE_MS : SILENT_GRACE_MS;
      if (why === "closing") endGrace();
      else startGrace(ms);
    }
    follow();
    refresh();
  };
  /** REQ-391 — ask the deploy's time; the answer sets `skew` (Cristian: halfway through the trip) */
  const askTime = () => wsSend({ t: "time", c: Date.now() });
  /** REQ-648 — and again at each TIME_AGAIN_MS after the welcome: the quickest trip wins */
  let timeAgain: ReturnType<typeof setTimeout>[] = [];
  const askTimes = () => {
    for (const h of timeAgain) clearTimeout(h);
    askTime();
    timeAgain = TIME_AGAIN_MS.map((ms) => setTimeout(askTime, ms));
  };
  const tookTime = (c: number, s: number) => {
    const now = Date.now();
    const rtt = now - c;
    if (rtt < 0 || rtt >= bestRtt) return;
    bestRtt = rtt;
    skew = s + rtt / 2 - now;
  };
  /** REQ-436 — a claim's browser-tab key and focus (the customer's side) */
  const claimExtras = () => ({
    ...(o.tab ? { tab: o.tab } : {}),
    ...(o.hasFocus?.() ? { f: 1 as const } : {}),
  });
  /** REQ-232 — the customer's side: say again that this tab is the one in use; REQ-436 — a page
   *  with a browser-tab key says which tab it is even when it never claimed (`at` 0) */
  const reclaim = () => {
    if (claimedAt > 0 || o.tab) {
      wsSend({ t: "claim", at: claimedAt, ...claimExtras() });
    }
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
          askTimes(); // REQ-391, REQ-648
          break;
        case "time":
          tookTime(m.c, m.s);
          break;
        case "peer":
          if (m.pid !== undefined) stageSeen(m.online, m.pid, m.cid);
          else if (o.role === "presenter") {
            if (m.online) tabSeen(m.cid ?? NO_CID);
            else tabLeft(m.cid ?? NO_CID, m.why, m.at);
          }
          break;
        case "claim":
          if (o.role === "presenter") tabSeen(m.cid, m.at, m.tab, m.f === 1);
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
      release();
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
        // REQ-393 — to the tab this stage follows only, as the data channel is (the hub handed a
        // bare relay to every tab of the customer's)
        wsSend({
          t: "relay",
          data: m,
          ...(followed ? { tab: followed } : {}),
        });
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
      wsSend({ t: "claim", at: claimedAt, ...claimExtras() });
    },
    leaving(why) {
      wsSend({ t: "leaving", why });
    },
    now: () => Date.now() + skew,
    end() {
      wsSend({ t: "end" });
    },
    close() {
      closed = true;
      clearTimeout(retry);
      for (const h of timeAgain) clearTimeout(h);
      endGrace();
      release();
      teardownAll();
      const sock = ws;
      ws = null;
      try {
        sock?.close();
      } catch { /* already closed */ }
    },
  };
}
