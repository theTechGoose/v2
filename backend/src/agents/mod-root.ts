import { Module } from "#danet/core";
import { UsersModule } from "@users/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CommunicationModule } from "@communication/mod-root.ts";
import { FilesModule } from "@files/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { ConversationsController } from "@agents/entrypoints/conversations-controller/mod.ts";
import { ChatController } from "@agents/entrypoints/chat-controller/mod.ts";
import { WizardController } from "@agents/entrypoints/wizard-controller/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StartConversation } from "@agents/domain/coordinators/start-conversation/mod.ts";
import { HandleChatMessage } from "@agents/domain/coordinators/handle-chat-message/mod.ts";
import { TransitionToTerms } from "@agents/domain/coordinators/transition-to-terms/mod.ts";
import { HandleWizardAnswer } from "@agents/domain/coordinators/handle-wizard-answer/mod.ts";
import { LoadConversation } from "@agents/domain/coordinators/load-conversation/mod.ts";
import { LockQuote } from "@agents/domain/coordinators/lock-quote/mod.ts";
import { AcceptContract } from "@agents/domain/coordinators/accept-contract/mod.ts";
import { SendContract } from "@agents/domain/coordinators/send-contract/mod.ts";
import { SendInvoice } from "@agents/domain/coordinators/send-invoice/mod.ts";
import { StartOnboardingConversation } from "@agents/domain/coordinators/start-onboarding-conversation/mod.ts";
import { LLM_CLIENT } from "@agents/domain/business/llm/base/mod.ts";
import type { LLMClient } from "@agents/domain/business/llm/base/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";

/**
 * Pick the LLM client CLASS at module-load time:
 *   - `AGENTS_LLM_CLIENT=openai`  → OpenAILLMClient (requires OPENAI_API_KEY)
 *   - anything else (default)     → StubLLMClient
 *
 * Tests don't set the env var, so they always get the stub — no live
 * API calls and no need for an OPENAI_API_KEY in CI. The `start` and
 * `dev` deno tasks set `AGENTS_LLM_CLIENT=openai` so the production
 * server uses the real client.
 *
 * Returns a CLASS (not an instance). Danet's `useClass` injector will
 * call `new ClientClass()` once per app boot — both classes have a
 * zero-arg constructor (StubLLMClient is empty; OpenAILLMClient reads
 * its config from env).
 *
 * The OpenAI module is dynamically imported (top-level await) so the
 * npm:openai dep doesn't load when the stub is selected.
 */
async function selectLLMClass(): Promise<new () => LLMClient> {
  if (Deno.env.get("AGENTS_LLM_CLIENT") === "openai") {
    const { OpenAILLMClient } = await import("@agents/domain/data/openai/mod.ts");
    return OpenAILLMClient;
  }
  return StubLLMClient;
}

const LlmClientClass = await selectLLMClass();

/**
 * AgentsModule wires the two-phase agent surface:
 *   - POST /agents/chat                                    (phase 1)
 *   - POST /agents/wizard/answer                           (phase 2)
 *   - POST /agents/conversations                           (start)
 *   - POST /agents/conversations/:id/transition-to-terms   (phase 1 → 2)
 *   - GET  /agents/conversations[?limit=]                  (sidebar list)
 *   - GET  /agents/conversations/:id                       (load full thread + wizard)
 *   - DELETE /agents/conversations/:id
 */
@Module({
  imports: [UsersModule, PaperworkModule, CommunicationModule, FilesModule, CrmModule],
  controllers: [ConversationsController, ChatController, WizardController],
  injectables: [
    AgentConversationStore,
    AgentMessageStore,
    StartConversation,
    HandleChatMessage,
    TransitionToTerms,
    HandleWizardAnswer,
    LoadConversation,
    LockQuote,
    AcceptContract,
    SendContract,
    SendInvoice,
    StartOnboardingConversation,
    { token: LLM_CLIENT, useClass: LlmClientClass },
  ],
})
export class AgentsModule {}
