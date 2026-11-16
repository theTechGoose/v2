import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { LLM_CLIENT, type LLMClient } from "@agents/domain/business/llm/base/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import { selectLlmClientName } from "@agents/domain/business/llm/select/mod.ts";
import { TextsController } from "@communications/entrypoints/texts-controller/mod.ts";
import { ThreadsController } from "@communications/entrypoints/threads-controller/mod.ts";
import { CallsController } from "@communications/entrypoints/calls-controller/mod.ts";
import { VoiceController } from "@communications/entrypoints/voice-controller/mod.ts";
import { TwilioWebhooksController } from "@communications/entrypoints/twilio-webhooks-controller/mod.ts";
import { LinesController } from "@communications/entrypoints/lines-controller/mod.ts";
import { TwilioClient } from "@communications/domain/data/twilio-client/mod.ts";
import { CommsConfigSource } from "@communications/domain/data/config/mod.ts";
import { ThreadStore } from "@communications/domain/data/thread-store/mod.ts";
import { TextMessageStore } from "@communications/domain/data/text-message-store/mod.ts";
import { CallStore } from "@communications/domain/data/call-store/mod.ts";
import { LineStore } from "@communications/domain/data/line-store/mod.ts";
import { SendText } from "@communications/domain/coordinators/send-text/mod.ts";
import { VerifyWebhook } from "@communications/domain/coordinators/verify-webhook/mod.ts";
import { ReceiveText } from "@communications/domain/coordinators/receive-text/mod.ts";
import { TextStatus } from "@communications/domain/coordinators/text-status/mod.ts";
import { Threads } from "@communications/domain/coordinators/threads/mod.ts";
import { MintVoiceToken } from "@communications/domain/coordinators/mint-voice-token/mod.ts";
import { VoiceOutgoing } from "@communications/domain/coordinators/voice-outgoing/mod.ts";
import { VoiceIncoming } from "@communications/domain/coordinators/voice-incoming/mod.ts";
import { VoiceUnanswered } from "@communications/domain/coordinators/voice-unanswered/mod.ts";
import { RelaySession } from "@communications/domain/coordinators/relay-session/mod.ts";
import { RelayDone } from "@communications/domain/coordinators/relay-done/mod.ts";
import { CallStatus } from "@communications/domain/coordinators/call-status/mod.ts";
import { CallRecording } from "@communications/domain/coordinators/call-recording/mod.ts";
import { Calls } from "@communications/domain/coordinators/calls/mod.ts";
import { Lines } from "@communications/domain/coordinators/lines/mod.ts";
import { LineContext } from "@communications/domain/coordinators/line-context/mod.ts";

/** the same switch as AgentsModule: OpenAI when AGENTS_LLM_CLIENT=openai, the stub otherwise (never the stub in prod) */
async function selectLLMClass(): Promise<new () => LLMClient> {
  const which = selectLlmClientName({
    AGENTS_LLM_CLIENT: Deno.env.get("AGENTS_LLM_CLIENT"),
    DENO_DEPLOYMENT_ID: Deno.env.get("DENO_DEPLOYMENT_ID"),
  });
  if (which === "openai") {
    const { OpenAILLMClient } = await import("@agents/domain/data/openai/mod.ts");
    return OpenAILLMClient;
  }
  return StubLLMClient;
}
const LlmClientClass = await selectLLMClass();

/**
 * CommunicationsModule — REQ-899..905. A phone line per customer: the env
 * line (ours, `COMMS_TWILIO_*`, owned by COMMS_ENV_LINE_OWNER) and a line each
 * customer buys on a Twilio subaccount of ours (REQ-903) — texting (threads
 * per peer), a browser softphone (token, outbound dial, inbound ring), and
 * the AI receptionist over ConversationRelay. Every request acts on exactly
 * one line (REQ-904).
 * A sibling of `communication` (conversations / notifications / email), on purpose.
 *
 *   POST /communications/texts                      send a text
 *   GET  /communications/threads[/:peer]            the inbox
 *   GET  /communications/calls[/:id]                the call log
 *   POST /communications/voice/token                softphone token
 *   GET  /communications/voice/relay                ConversationRelay websocket (Twilio)
 *   POST /communications/twilio/*                   Twilio webhooks (per-line signature-gated)
 *   GET  /communications/numbers/available          numbers for sale (areaCode / contains)
 *   POST /communications/numbers                    buy one → the user's line
 *   GET  /communications/line                       the user's line (redacted)
 *   POST /communications/line/release               give it back
 */
@Module({
  imports: [UsersModule],
  controllers: [TextsController, ThreadsController, CallsController, VoiceController, TwilioWebhooksController, LinesController],
  injectables: [
    CommsConfigSource,
    TwilioClient,
    ThreadStore,
    TextMessageStore,
    CallStore,
    LineStore,
    LineContext,
    Lines,
    SendText,
    VerifyWebhook,
    ReceiveText,
    TextStatus,
    Threads,
    MintVoiceToken,
    VoiceOutgoing,
    VoiceIncoming,
    VoiceUnanswered,
    RelaySession,
    RelayDone,
    CallStatus,
    CallRecording,
    Calls,
    { token: LLM_CLIENT, useClass: LlmClientClass },
  ],
})
export class CommunicationsModule {}
