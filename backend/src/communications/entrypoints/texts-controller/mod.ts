/** REQ-899/904 — POST /communications/texts (from the signed-in user's line; 409 no_line without one) */
import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { parseSendText } from "@communications/dto/mod.ts";
import { SendText } from "@communications/domain/coordinators/send-text/mod.ts";
import { LineContext } from "@communications/domain/coordinators/line-context/mod.ts";

@Controller("communications/texts")
export class TextsController {
  constructor(private sendText: SendText, private lineContext: LineContext, private users: UserStore, private sessions: SessionStore) {}

  @Post()
  async send(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const input = parseSendText(body);
    return await this.sendText.send(input, await this.lineContext.forUser(user.id));
  }
}
