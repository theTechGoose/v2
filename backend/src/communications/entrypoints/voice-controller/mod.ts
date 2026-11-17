/**
 * REQ-900/901 — POST /communications/voice/token (the softphone's token) and
 * GET /communications/voice/relay (Twilio ConversationRelay's websocket).
 *
 * The relay socket is opened by Twilio, not a browser, and Twilio cannot sign
 * a websocket upgrade the way it signs webhooks. What protects it: the URL is
 * only ever handed to Twilio inside TwiML we generate, every frame is parsed
 * through the pure relay reducer (junk is ignored), and a session can only
 * write to the call id it was given in <Parameter>, which is a KV uuid.
 */
import { Context, Controller, Get, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { MintVoiceToken } from "@communications/domain/coordinators/mint-voice-token/mod.ts";
import { RelaySession } from "@communications/domain/coordinators/relay-session/mod.ts";

@Controller("communications/voice")
export class VoiceController {
  constructor(
    private mint: MintVoiceToken,
    private relay: RelaySession,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  @Post("token")
  async token(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    return await this.mint.mint(user.id);
  }

  @Get("relay")
  relaySocket(@Context() ctx: ExecutionContext): Response {
    const req = ctx.req.raw;
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }
    let upgraded: Deno.WebSocketUpgrade;
    try {
      upgraded = Deno.upgradeWebSocket(req);
    } catch (err) {
      return new Response(`upgrade failed: ${(err as Error).message}`, { status: 400 });
    }
    const { socket, response } = upgraded;
    const session = this.relay.start();
    // frames are handled one at a time, in order — the LLM turn must finish before the next prompt is reduced
    let chain: Promise<void> = Promise.resolve();
    socket.onmessage = (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : "";
      chain = chain.then(async () => {
        const step = await this.relay.handleFrame(session, raw);
        for (const msg of step.outbound) {
          if (socket.readyState === WebSocket.OPEN) socket.send(msg);
        }
        if (step.end) {
          // Twilio closes after it has spoken the last token; give it a moment, then make sure
          setTimeout(() => {
            if (socket.readyState === WebSocket.OPEN) socket.close(1000, "session ended");
          }, 15_000);
        }
      }).catch((err) => console.error("[communications/relay] frame failed:", (err as Error).message));
    };
    socket.onerror = (ev) => console.error("[communications/relay] socket error", (ev as ErrorEvent).message ?? "");
    return response;
  }
}
