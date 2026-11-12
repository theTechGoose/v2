import { Context, Controller, Get } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { parseClientMessage, type ServerMessage } from "#demo-mode/protocol.ts";
import { DemoSessionStore } from "@demo-mode/domain/data/demo-session-store/mod.ts";
import {
  DemoHub,
  type Peer,
} from "@demo-mode/domain/coordinators/demo-hub/mod.ts";
import { DemoAccess } from "@demo-mode/domain/coordinators/demo-access/mod.ts";

/**
 * REQ-153 — the demo's signaling socket: GET /api/demo-mode/ws?session=<id>[&token=<sessionId>].
 *
 * Under `api/` on purpose: the deploy's root router hands a WebSocket upgrade to the backend with
 * the ORIGINAL request, path untouched (compose-router.ts — a re-wrapped Request cannot upgrade),
 * and the dev Vite proxy forwards this path unchanged, so the browser's one URL works on every
 * host. Auth is the session cookie (the browser sends it with the upgrade), the header, or the
 * `token` query for clients that can set neither; the role comes from the demo (demo-role).
 *
 * Wire: the first frame is `welcome` (a presenter's carries their `pid`, REQ-214; every one this
 * socket's own `cid`, REQ-232), then a `peer` per socket already here that this one cares about;
 * then `peer`, forwarded `signal`/`relay` stamped `from` (and `pid` when from a presenter, `cid`
 * always), a tab's `claim`, a stage's `sync`, `replaced` (this staff account opened the demo in a
 * newer window) and `ended` — after the last two the socket is closed. The fan-out (across
 * isolates too) is DemoHub.
 *
 * REQ-391 — two messages stay with the socket: `time` is answered with the deploy's clock (each
 * browser's offset to it, so the stage can measure how late a frame is), and `leaving` keeps why
 * the page is going on the peer — its departure (`peer … online:false`) carries it.
 */
@Controller("api/demo-mode")
export class DemoModeSocketController {
  constructor(
    private demos: DemoSessionStore,
    private hub: DemoHub,
    private access: DemoAccess,
  ) {}

  @Get("ws")
  async ws(@Context() ctx: ExecutionContext): Promise<Response> {
    const req = ctx.req.raw;
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }
    const url = new URL(req.url);
    const caller = await this.access.caller(ctx, url.searchParams.get("token"));
    const sessionId = url.searchParams.get("session") ?? "";
    const { role, pid } = await this.access.roleIn(caller, sessionId);

    const { socket, response } = Deno.upgradeWebSocket(req);
    const sendJson = (m: ServerMessage) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
    };
    // REQ-232 — this socket's own id: a customer's tab or a staff stage, never "the" viewer
    const cid = crypto.randomUUID();
    const peer: Peer = {
      role,
      ...(pid ? { pid } : {}),
      cid,
      send: sendJson,
      close: () => {
        try {
          socket.close(1000, "ended");
        } catch { /* already closed */ }
      },
    };
    let leave: (() => void) | null = null;
    // REQ-292 — the socket may close while the join is awaited: then the peer leaves as soon as
    // it is in, so a tab closed mid-join is removed and announced, never a ghost
    let closed = false;
    const onGone = () => {
      closed = true;
      leave?.();
    };

    socket.onopen = async () => {
      // welcome first (with this socket's cid), then who is already here — a tab hears of the
      // stages (REQ-214: by pid), a stage of the tabs and of the other accounts' stages, each by
      // cid (REQ-232). REQ-378 (m22): sent from inside the join, BEFORE the others hear this socket
      // arrive — a tab answers a stage's arrival with its snapshot at once, and a stage that got
      // that snapshot ahead of its peer list dropped it (it follows no tab yet)
      const joined = await this.hub.join(sessionId, peer, (g) => {
        sendJson({
          t: "welcome",
          role,
          sessionId,
          peerOnline: g.peerOnline,
          ...(pid ? { pid } : {}),
          cid,
        });
        for (const p of g.peers) {
          sendJson({
            t: "peer",
            online: true,
            ...(p.pid ? { pid: p.pid } : {}),
            cid: p.cid,
            // REQ-640 (cycle 5, m24) — a tab's kept claim: the stage ranks it on arrival
            ...(p.at !== undefined ? { at: p.at } : {}),
            ...(p.tab ? { tab: p.tab } : {}),
            ...(p.f === 1 ? { f: 1 as const } : {}),
            ...(p.i === 1 ? { i: 1 as const } : {}),
          });
        }
      });
      leave = joined.leave;
      if (closed) return leave();
    };
    socket.onmessage = async (e) => {
      if (typeof e.data !== "string") return;
      const m = parseClientMessage(e.data);
      if (!m) return;
      // REQ-391 — the browser asks the deploy's time: answered at once, to this socket only
      if (m.t === "time") return sendJson({ t: "time", c: m.c, s: Date.now() });
      // REQ-391 — this socket's page is going, and says why: kept (before anything is awaited:
      // the close comes right behind it) for the departure the hub announces
      if (m.t === "leaving") {
        peer.leaving = m.why;
        return;
      }
      // A message still in flight when the store goes away (a shutdown, a test's teardown) must
      // not become an unhandled rejection — Deno ends the whole process on one.
      try {
        if (m.t === "end") {
          const demo = await this.demos.end(sessionId);
          // REQ-235 — everyone hears who ended it
          if (demo) {
            await this.hub.end(sessionId, role, undefined, pid ?? undefined);
          }
          return;
        }
        await this.hub.send(
          sessionId,
          { role, ...(pid ? { pid } : {}), cid },
          m,
        );
      } catch (err) {
        console.warn("[demo-socket] message not delivered:", err);
      }
    };
    socket.onclose = onGone;
    socket.onerror = onGone;
    return response;
  }
}
