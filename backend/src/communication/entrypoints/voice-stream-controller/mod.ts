import { Context, Controller, Get } from "#danet/core";
import type { ExecutionContext } from "#danet/core";

/**
 * VoiceStreamController — WebSocket bridge between the browser and
 * AssemblyAI's Streaming v3 endpoint.
 *
 * Why a server-side proxy:
 *   - Keeps `ASSEMBLYAI_API_KEY` server-side. Browser only knows about
 *     our own URL.
 *   - Centralises any future auth gating (rate-limit per session,
 *     short-lived tokens, etc.) in one place.
 *   - Normalises the wire format so the FE doesn't need to track
 *     AAI version drift.
 *
 * Wire format (browser side):
 *   - The client connects to `ws://<host>/voice/stream?sample_rate=48000`.
 *   - Audio: 16-bit signed PCM little-endian mono frames as binary WS
 *     messages (one ScriptProcessor buffer per frame, ~85ms at 48kHz).
 *   - Receives JSON text frames mirroring AssemblyAI's v3 schema:
 *       { type: "Begin",       id, expires_at }
 *       { type: "Turn",        transcript, end_of_turn, words?, ... }
 *       { type: "Termination", code, reason }
 *       { type: "error",       error }
 *
 * To stop: client sends `{type:"Terminate"}` text frame, or just closes
 * the socket. Either way we propagate to upstream and clean up.
 */

const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") ?? "";
const ASSEMBLYAI_WS_BASE = "wss://streaming.assemblyai.com/v3/ws";

@Controller("voice")
export class VoiceStreamController {
  @Get("stream")
  stream(@Context() ctx: ExecutionContext): Response {
    const req = ctx.req.raw;
    const upgrade = req.headers.get("upgrade")?.toLowerCase();
    if (upgrade !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }
    if (!ASSEMBLYAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "voice_disabled", reason: "ASSEMBLYAI_API_KEY not set" }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    }

    const url = new URL(req.url);
    const sampleRate = Number(url.searchParams.get("sample_rate") ?? 16000) || 16000;
    const upstreamUrl =
      `${ASSEMBLYAI_WS_BASE}?sample_rate=${sampleRate}&format_turns=true&token=${
        encodeURIComponent(ASSEMBLYAI_API_KEY)
      }`;

    let upgraded;
    try {
      upgraded = Deno.upgradeWebSocket(req);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "upgrade_failed", reason: (err as Error).message }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
    const clientSocket = upgraded.socket;
    clientSocket.binaryType = "arraybuffer";

    let upstream: WebSocket | null = null;
    let upstreamReady = false;
    /** Buffer audio frames that arrive before upstream confirms `Begin`
     *  so we don't drop the user's first syllable. Cap at ~32 frames
     *  (~2-3s of audio) so a stuck upstream can't grow memory unbounded. */
    const earlyAudioBuffer: ArrayBuffer[] = [];

    const safeSendJson = (s: WebSocket, payload: Record<string, unknown>) => {
      if (s.readyState === WebSocket.OPEN) {
        try { s.send(JSON.stringify(payload)); } catch { /* peer gone */ }
      }
    };

    const teardown = (reason?: string) => {
      try {
        if (upstream && upstream.readyState === WebSocket.OPEN) {
          upstream.send(JSON.stringify({ type: "Terminate" }));
        }
      } catch { /* ignore */ }
      try { upstream?.close(); } catch { /* ignore */ }
      try { clientSocket.close(1000, reason ?? "ok"); } catch { /* ignore */ }
    };

    clientSocket.onopen = () => {
      try {
        upstream = new WebSocket(upstreamUrl);
        upstream.binaryType = "arraybuffer";
      } catch (err) {
        safeSendJson(clientSocket, { type: "error", error: (err as Error).message });
        teardown("upstream_open_failed");
        return;
      }

      upstream.onopen = () => { /* AAI sends Begin once handshake completes */ };
      upstream.onmessage = (e) => {
        if (typeof e.data === "string") {
          if (clientSocket.readyState === WebSocket.OPEN) {
            try { clientSocket.send(e.data); } catch { /* ignore */ }
          }
          if (!upstreamReady) {
            try {
              const msg = JSON.parse(e.data);
              if (msg?.type === "Begin") {
                upstreamReady = true;
                for (const buf of earlyAudioBuffer) {
                  try { upstream?.send(buf); } catch { /* ignore */ }
                }
                earlyAudioBuffer.length = 0;
              }
            } catch { /* ignore */ }
          }
        }
      };
      upstream.onerror = () => {
        safeSendJson(clientSocket, { type: "error", error: "upstream_error" });
      };
      upstream.onclose = (ev) => {
        safeSendJson(clientSocket, { type: "Termination", code: ev.code, reason: ev.reason });
        teardown("upstream_closed");
      };
    };

    clientSocket.onmessage = (e) => {
      // Audio frames from the browser → upstream.
      if (e.data instanceof ArrayBuffer) {
        if (!upstream) return;
        if (!upstreamReady) {
          if (earlyAudioBuffer.length < 32) earlyAudioBuffer.push(e.data);
          return;
        }
        if (upstream.readyState === WebSocket.OPEN) {
          try { upstream.send(e.data); } catch { /* ignore */ }
        }
        return;
      }
      // Control frames from the browser.
      if (typeof e.data === "string") {
        if (upstream?.readyState === WebSocket.OPEN) {
          try { upstream.send(e.data); } catch { /* ignore */ }
        }
        try {
          const msg = JSON.parse(e.data);
          if (msg?.type === "Terminate") teardown("client_terminate");
        } catch { /* not JSON */ }
      }
    };

    clientSocket.onerror = () => { teardown("client_error"); };
    clientSocket.onclose = () => { teardown("client_closed"); };

    return upgraded.response;
  }
}
