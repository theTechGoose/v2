import { Body, Context, Controller, Get, Put } from "#danet/core";
import type { ExecutionContext } from "#danet/core";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { parseUpdateBusinessIdentity } from "@profile/dto/business-identity.ts";
import { requireUser } from "@users/domain/coordinators/require-user/mod.ts";
import { CrmLeadCapture } from "@users/domain/coordinators/crm-lead-capture/mod.ts";
import { validTimezone } from "@users/domain/business/timezone/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { sniffLogoImage } from "#quote-flow/logo-image.ts";
import {
  commsLanguagesSeed,
  hasSendLanguage,
} from "#quote-flow/comms-language.ts";
import { businessNameError } from "#quote-flow/settings-fields.ts";

/** REQ-172 — a time zone Intl does not know is a 400, not a stored string */
class BadTimezone extends Error {
  readonly status = 400;
  constructor(tz: string) {
    super(`unknown time zone: ${tz}`);
  }
}

/** REQ-501 (demo M35) — a blank business name once one is set is a 400 naming welcome.nameBlank */
class BlankBusinessName extends Error {
  readonly status = 400;
  constructor(key: string) {
    super(key);
  }
}

/** REQ-500 (demo cycle 3, M34) — at least one send-in language stays on: an empty list is a 400, not a stored [] */
class NoSendLanguage extends Error {
  readonly status = 400;
  constructor() {
    super("commsLanguages must name at least one language (en, es)");
  }
}

/** REQ-252 (M30) — the logo must be one of this account's files AND an image by its bytes.
 *  (A free function: Danet routes every method on a controller, so no undecorated helpers.) */
async function isOwnImage(
  files: FileStore,
  fileId: string,
  userId: string,
): Promise<boolean> {
  try {
    await files.getOwnedMeta(fileId, userId);
    return sniffLogoImage(await files.readHead(fileId)) !== null;
  } catch {
    return false; // unknown or another account's file — refused the same way, nothing leaks
  }
}

@Controller("profile/identity")
export class BusinessIdentityController {
  constructor(
    private store: BusinessIdentityStore,
    private users: UserStore,
    private sessions: SessionStore,
    private leads: CrmLeadCapture,
    private files: FileStore,
  ) {}

  @Get()
  async get(@Context() ctx: ExecutionContext) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const value = await this.store.get(user.id); // null when not yet created
    return ctx.json(value); // ctx.json(null) → body "null", not empty
  }

  @Put()
  async upsert(@Context() ctx: ExecutionContext, @Body() body: unknown) {
    const user = await requireUser(ctx, this.sessions, this.users);
    const patch = parseUpdateBusinessIdentity(body);
    if (patch.timezone !== undefined && !validTimezone(patch.timezone)) {
      throw new BadTimezone(String(patch.timezone));
    }
    if (
      patch.commsLanguages != null && !hasSendLanguage(patch.commsLanguages)
    ) throw new NoSendLanguage();
    if (
      patch.logoFileId &&
      !(await isOwnImage(this.files, patch.logoFileId, user.id))
    ) {
      return ctx.json({ error: "logo_not_image" }, 422);
    }
    const current = await this.store.get(user.id);
    // REQ-501 (demo M35): Settings blurred an emptied business name and the PUT stored ""
    const nameErr = businessNameError(
      patch.businessName,
      current?.businessName,
    );
    if (nameErr) throw new BlankBusinessName(nameErr);
    if (patch.businessName !== undefined) {
      patch.businessName = patch.businessName.trim();
    }
    // REQ-348 (demo m34): an identity with no send-in languages picked takes the default from the
    // contractor's own language (es → en + es) — Settings used to show English alone for a Spanish signup
    const seed = commsLanguagesSeed(current, patch, user.language);
    const saved = await this.store.upsert(
      user.id,
      seed ? { ...patch, commsLanguages: seed } : patch,
    );
    await this.leads.enqueueSync(user.id); // REQ-058/099 — the business name is the CRM customer's name, after this reply
    return saved;
  }
}
