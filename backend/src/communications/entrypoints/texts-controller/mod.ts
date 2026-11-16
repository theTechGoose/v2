/** REQ-899 — POST /communications/texts */
import { Body, Context, Controller, Post } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { parseSendText } from "@communications/dto/mod.ts";
import { SendText } from "@communications/domain/coordinators/send-text/mod.ts";

@Controller("communications/texts")
export class TextsController {
  constructor(private sendText: SendText, private users: UserStore, private sessions: SessionStore) {}

  @Post()
  async send(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    await requireUser(ctx, this.sessions, this.users);
    return await this.sendText.send(parseSendText(body));
  }
}
