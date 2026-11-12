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
 * Wire: the first frame is `welcome` (a presenter's carries their `pid`, REQ-214), then a `peer`
 * per other presenter already here; then `peer`, forwarded `signal`/`relay` stamped `from` (and
 * `pid` when from a presenter), and `ended` — after which the socket is closed. The fan-out
 * (across isolates too) is DemoHub.
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
    const peer: Peer = {
      role,
      ...(pid ? { pid } : {}),
      send: sendJson,
      close: () => {
        try {
          socket.close(1000, "ended");
        } catch { /* already closed */ }
      },
    };
    let leave: (() => void) | null = null;

    socket.onopen = async () => {
      const joined = await this.hub.join(sessionId, peer);
      leave = joined.leave;
      // welcome first: join tells the OTHERS only, so nothing reached this socket yet; then
      // (REQ-214) the other presenters already here, by pid
      sendJson({
        t: "welcome",
        role,
        sessionId,
        peerOnline: joined.peerOnline,
        ...(pid ? { pid } : {}),
      });
      for (const other of joined.others) {
        sendJson({ t: "peer", online: true, pid: other });
      }
    };
    socket.onmessage = async (e) => {
      if (typeof e.data !== "string") return;
      const m = parseClientMessage(e.data);
      if (!m) return;
      if (m.t === "end") {
        const demo = await this.demos.end(sessionId);
        // REQ-235 — everyone hears who ended it
        if (demo) {
          await this.hub.end(sessionId, role, undefined, pid ?? undefined);
        }
        return;
      }
      await this.hub.send(sessionId, pid ? { role, pid } : { role }, m);
    };
    socket.onclose = () => leave?.();
    socket.onerror = () => leave?.();
    return response;
  }
}
