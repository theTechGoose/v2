import { Body, Context, Controller, Get, Put } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { parseUpdateBusinessIdentity } from "@profile/dto/business-identity.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { CrmLeadCapture } from "@users/domain/coordinators/crm-lead-capture/mod.ts";
import { validTimezone } from "@users/domain/business/timezone/mod.ts";
import { checkPayLinks } from "#payments/pay-links.ts";

/** REQ-172 — a time zone Intl does not know is a 400, not a stored string */
class BadTimezone extends Error {
  readonly status = 400;
  constructor(tz: string) {
    super(`unknown time zone: ${tz}`);
  }
}

@Controller("profile/identity")
export class BusinessIdentityController {
  constructor(
    private store: BusinessIdentityStore,
    private users: UserStore,
    private sessions: SessionStore,
    private leads: CrmLeadCapture,
  ) {}

  @Get()
  async get(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const value = await this.store.get(user.id);       // null when not yet created
    return ctx.json(value);                            // ctx.json(null) → body "null", not empty
  }

  @Put()
  async upsert(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    // REQ-630 — the other payment links: a name and an https URL each; refused whole, never half-stored
    const rawLinks = (body as { acceptedPaymentMethods?: { links?: unknown } } | null)
      ?.acceptedPaymentMethods?.links;
    let links;
    if (rawLinks !== undefined) {
      const checked = checkPayLinks(rawLinks);
      if (!checked.ok) {
        return ctx.json({ error: `pay_link_${checked.reason}`, index: checked.index }, 400);
      }
      links = checked.links;
    }
    const patch = parseUpdateBusinessIdentity(body);
    if (links && patch.acceptedPaymentMethods) patch.acceptedPaymentMethods.links = links;
    if (patch.timezone !== undefined && !validTimezone(patch.timezone)) throw new BadTimezone(String(patch.timezone));
    const saved = await this.store.upsert(user.id, patch);
    await this.leads.enqueueSync(user.id); // REQ-058/099 — the business name is the CRM customer's name, after this reply
    return saved;
  }
}
