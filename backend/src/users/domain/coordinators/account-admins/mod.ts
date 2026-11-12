import { Injectable } from "#danet/core";
import { t } from "@core/i18n/mod.ts";
import { appUrl } from "@users/domain/business/app-url/mod.ts";
import { AccountAdminStore } from "@users/domain/data/account-admin-store/mod.ts";
import {
  type Session,
  SessionStore,
} from "@users/domain/data/session-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import {
  accountLabel,
  inviteCheck,
  realName,
} from "@users/domain/business/account-admins/mod.ts";
import type { AccountAdmin } from "@users/dto/account-admin.ts";
import type { User } from "@users/dto/user.ts";

/** a refused invite or switch: `status` + a stable `error` word for the client */
export class AccountAdminError extends Error {
  constructor(readonly error: string, readonly status: number) {
    super(error);
    this.name = "AccountAdminError";
  }
}

export interface AccountEntry {
  userId: string;
  label: string;
  role: "owner" | "admin";
}

export interface AccountsView {
  actor: { id: string; name?: string; phoneNumber: string };
  currentUserId: string;
  accounts: AccountEntry[];
}

/**
 * REQ-146 — AccountAdmins: the owner invites and removes phone numbers; a
 * session reads the accounts it can act in and switches between them.
 */
@Injectable()
export class AccountAdmins {
  constructor(
    private admins: AccountAdminStore,
    private sessions: SessionStore,
    private users: UserStore,
    private identities: BusinessIdentityStore,
    private sms: SmsService,
  ) {}

  /** the owner invites a phone: the record, then the text (its failure is logged, never thrown).
   *  REQ-523 (demo m16): the answer says whether the text went out (`texted`) — the page
   *  never claims an invite was texted to a number that could not get it. */
  async invite(
    owner: User,
    input: { phoneNumber?: unknown; name?: unknown },
  ): Promise<
    AccountAdmin & { texted: boolean; signInUrl: string; shareText: string }
  > {
    let phone: string;
    try {
      phone = normalizePhone(
        typeof input.phoneNumber === "string" ? input.phoneNumber : "",
      );
    } catch {
      throw new AccountAdminError("bad_phone", 400);
    }
    const refused = inviteCheck(owner.phoneNumber, phone);
    if (refused) throw new AccountAdminError(refused, 400);
    if (await this.admins.find(phone, owner.id)) {
      throw new AccountAdminError("already_invited", 409);
    }
    const name = typeof input.name === "string" && input.name.trim()
      ? input.name.trim().slice(0, 120)
      : undefined;
    const rec = await this.admins.create({
      userId: owner.id,
      phoneNumber: phone,
      name,
    });
    const lang = owner.language === "es" ? "es" : "en";
    const identity = await this.identities.get(owner.id);
    // "Raphael (Monster RG) added you…": the person, the business after them when there is one
    const who = realName(owner.name);
    const biz = identity?.businessName?.trim();
    const ownerText = who && biz ? `${who} (${biz})` : accountLabel(owner, biz);
    const url = appUrl();
    const body = t(lang, "sms.adminInvite", { owner: ownerText, url });
    const sent = await this.sms.send({ to: phone, body });
    if (!sent.ok) {
      console.error(
        `[account-admins] invite text to ${phone} failed: ${sent.reason}`,
      );
    }
    // REQ-601 — the sign-in address and the very text, so the page can hand them over when the text failed
    return { ...rec, texted: sent.ok, signInUrl: url, shareText: body };
  }

  list(owner: User): Promise<AccountAdmin[]> {
    return this.admins.listByUser(owner.id);
  }

  /** the owner removes one: the record goes; every session acting on it 401s from the next request (requireUser) */
  async remove(owner: User, id: string): Promise<void> {
    const rec = await this.admins.getOwned(id, owner.id);
    await this.admins.delete(rec);
  }

  /** the person behind a session — the actor when acting, the user otherwise */
  private async actorOf(session: Session, effective: User): Promise<User> {
    return session.actorId ? await this.users.get(session.actorId) : effective;
  }

  /** the accounts a session's person can act in: their own first, then each they administer */
  async accountsFor(session: Session, effective: User): Promise<AccountsView> {
    const actor = await this.actorOf(session, effective);
    const memberships = await this.admins.listByPhone(actor.phoneNumber);
    const ownIdentity = await this.identities.get(actor.id);
    const accounts: AccountEntry[] = [{
      userId: actor.id,
      label: accountLabel(actor, ownIdentity?.businessName),
      role: "owner",
    }];
    for (const m of memberships) {
      const owner = await this.users.get(m.userId).catch(() => null);
      if (!owner || owner.deletedAt) continue;
      const identity = await this.identities.get(owner.id);
      accounts.push({
        userId: owner.id,
        label: accountLabel(owner, identity?.businessName),
        role: "admin",
      });
    }
    const name = realName(actor.name) ?? memberships.find((m) => m.name)?.name;
    return {
      actor: {
        id: actor.id,
        phoneNumber: actor.phoneNumber,
        ...(name ? { name } : {}),
      },
      currentUserId: effective.id,
      accounts,
    };
  }

  /** a new session in `userId` — the person's own account, or one they administer; the old session is dropped */
  async switchTo(
    session: Session,
    effective: User,
    userId: unknown,
  ): Promise<Session> {
    const actor = await this.actorOf(session, effective);
    const target = typeof userId === "string" ? userId : "";
    let next: Session;
    if (target === actor.id) {
      next = await this.sessions.create(actor.id);
    } else {
      const member = target
        ? await this.admins.find(actor.phoneNumber, target)
        : null;
      if (!member) throw new AccountAdminError("not_a_member", 403);
      next = await this.sessions.createActing(target, actor.id);
    }
    await this.sessions.delete(session.id);
    return next;
  }
}
