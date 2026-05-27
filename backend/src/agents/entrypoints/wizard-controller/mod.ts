import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { HandleWizardAnswer } from "@agents/domain/coordinators/handle-wizard-answer/mod.ts";
import { RewindWizard } from "@agents/domain/coordinators/rewind-wizard/mod.ts";
import { parseWizardAnswer } from "@agents/dto/wizard.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";

@Controller("agents/wizard")
export class WizardController {
  constructor(
    private flow: HandleWizardAnswer,
    private rewind: RewindWizard,
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  /**
   * POST /agents/wizard/answer
   * Body: { conversationId, stepId, optionId, customValue? }
   *
   * Returns: { conversation, wizardState, newMessages }
   */
  @Post("answer")
  async answer(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const dto = parseWizardAnswer(body);
    return ctx.json(
      await this.flow.run({
        userId: user.id,
        conversationId: dto.conversationId,
        stepId: dto.stepId,
        optionId: dto.optionId,
        customValue: dto.customValue,
        customer: dto.customer,
      }),
    );
  }

  /**
   * POST /agents/wizard/back
   * Body: { conversationId }
   *
   * Steps one wizard question backwards so the user can re-edit it
   * (roadmap p.2). Returns: { conversation, wizardState, activeStepId,
   * removedMessageIds }.
   */
  @Post("back")
  async back(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const conversationId = (body as { conversationId?: string })
      ?.conversationId;
    if (!conversationId) throw new Error("conversationId required");
    return ctx.json(await this.rewind.run({ userId: user.id, conversationId }));
  }
}
