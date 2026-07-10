import { Injectable } from "#danet/core";
import { t } from "@core/i18n/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import {
  ONBOARD_ASK_ADDRESS,
  ONBOARD_ASK_BUSINESS,
  ONBOARD_HANDOFF,
  onboardAskStateWithGuess,
} from "@agents/domain/business/onboarding/mod.ts";

/**
 * StartOnboardingConversation — first-run hand-off coordinator.
 *
 * Looks at the user's profile, picks the first missing field (name,
 * then businessName), and creates a fresh agent conversation seeded
 * with Bossie's first ask as an assistant `text` message. Returns the
 * new conversation id so the FE can navigate the user straight into
 * `/assistant/<id>` and they see the ask immediately — no "type
 * something to begin" empty-state friction.
 *
 * If both fields are already set, we still create a fresh conversation
 * but skip the seeded ask (the FE shouldn't be calling this in that
 * case, but the coordinator stays graceful).
 */
@Injectable()
export class StartOnboardingConversation {
  constructor(
    private conversations: AgentConversationStore,
    private messages: AgentMessageStore,
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private addresses: BusinessAddressStore,
  ) {}

  async run(
    input: {
      userId: string;
      /** Wizard finish hand-off: instead of asking for a missing field, seed
       *  the conversation with Bossie's "we're set — first quote?" invitation
       *  so the user lands in a ready-to-go chat. */
      handoff?: boolean;
      /** Optional concrete example the user picked on the finish screen,
       *  appended to the invitation as a "try this" nudge. */
      examplePrompt?: string;
    },
  ): Promise<{ conversationId: string; seeded: boolean }> {
    const [me, ident, addr] = await Promise.all([
      this.users.get(input.userId).catch(() => null),
      this.identity.get(input.userId).catch(() => null),
      this.addresses.get(input.userId).catch(() => null),
    ]);
    const needsName    = !me?.name || me.name.trim().length === 0;
    const needsBiz     = !ident?.businessName || ident.businessName.trim().length === 0;
    const needsState   = !addr?.state || addr.state.trim().length === 0;
    const needsAddress = !addr?.postal || addr.postal.trim().length === 0;

    const conv = await this.conversations.create({
      userId: input.userId,
      currentPhase: "quote",
    });

    // The assistant talks to the contractor, so the seeded ask follows their
    // UI language (user.language) — otherwise the app is Spanish but Bossie's
    // very first message is English.
    const lang = me?.language === "es" ? "es" : "en";
    const firstName = me?.name?.trim().split(/\s+/)[0] ?? "there";

    // Wizard finish hand-off: skip the field-asks entirely and seed the
    // "let's do your first quote" invitation. The seeded assistant message
    // does all the work — no AsstChat changes needed.
    if (input.handoff) {
      let handoff = ONBOARD_HANDOFF(firstName, lang);
      const example = (input.examplePrompt ?? "").trim().slice(0, 160);
      if (example) {
        handoff = `${handoff}\n\n${t(lang, "onboarding.handoffExample", { example })}`;
      }
      await this.messages.append({
        conversationId: conv.id, role: "assistant", kind: "text", content: handoff,
      });
      await this.conversations.update(conv.id, {
        preview: handoff,
        title: t(lang, "onboardingConversation.title"),
      });
      return { conversationId: conv.id, seeded: true };
    }

    let ask: string | undefined;
    if (needsName) ask = t(lang, "onboarding.askName");
    else if (needsBiz) ask = ONBOARD_ASK_BUSINESS(firstName, lang);
    else if (needsState) ask = onboardAskStateWithGuess(firstName, me?.phoneNumber, lang);
    else if (needsAddress) ask = ONBOARD_ASK_ADDRESS(firstName, lang);

    if (ask) {
      await this.messages.append({
        conversationId: conv.id, role: "assistant", kind: "text", content: ask,
      });
      await this.conversations.update(conv.id, {
        preview: ask,
        title: t(lang, "onboardingConversation.title"),
      });
      return { conversationId: conv.id, seeded: true };
    }
    return { conversationId: conv.id, seeded: false };
  }
}
