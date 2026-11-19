/**
 * REQ-884b / REQ-889 — the HR module's messages, through the existing SmsService and
 * EmailService: the signing link (text + email, in the owner's language), the 24-hour reminder
 * (once per hire, from a minute sweep — never Deno.cron, REQ-074 — and on every roster read),
 * the "packet complete" note to the HR address. The account's settings, with their defaults,
 * live here too. Nothing here throws into a route: a failed send is a log line and `false`.
 */
import { Injectable } from "#danet/core";
import { type Lang, t } from "@core/i18n/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { appUrl } from "@users/domain/business/app-url/mod.ts";
import {
  DEFAULT_SETTINGS,
  HireStore,
  HrSettingsStore,
} from "@hr/domain/data/hr-stores/mod.ts";
import {
  fullName,
  newHireSender,
  reminderDue,
} from "@hr/domain/business/onboarding/mod.ts";
import type { Hire, HrSettings } from "@hr/dto/hr.ts";

const EVERY_MINUTE_MS = 60_000;
type Timer = (fn: () => void, ms: number) => number;
type Unref = (id: number) => void;
const log = (line: string) => console.log(`[hr/notices] ${line}`);

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

/** the owner's language: their users.language, English unless it is Spanish */
export function ownerLang(
  user: { language?: string } | null | undefined,
): Lang {
  return user?.language === "es" ? "es" : "en";
}

@Injectable()
export class HrNotices {
  constructor(
    private users: UserStore,
    private identities: BusinessIdentityStore,
    private settingsStore: HrSettingsStore,
    private hires: HireStore,
    private sms: SmsService,
    private email: EmailService,
  ) {}

  /** the link the hire opens: the app's origin, /sign/<token>?lang=<the message's language>.
   *  REQ-1157 — /sign/:token reads ?lang first, so the page opens in the language the text and
   *  the email were written in, never the phone's last pm_lang cookie or the Spanish fallback. */
  signUrl(token: string, lang: Lang): string {
    return `${appUrl()}/sign/${token}?lang=${lang}`;
  }

  /** REQ-889a — the account's settings; the business's name and the owner's email stand in until set */
  async settingsFor(userId: string): Promise<HrSettings> {
    const stored = await this.settingsStore.find(userId);
    const [user, identity] = await Promise.all([
      this.users.get(userId).catch(() => null),
      this.identities.get(userId).catch(() => null),
    ]);
    const companyName = stored?.companyName?.trim() ||
      identity?.businessName?.trim() || identity?.legalName?.trim() ||
      user?.name?.trim() || "";
    const hrEmail = stored?.hrEmail?.trim() || user?.email?.trim() || "";
    return {
      ...DEFAULT_SETTINGS,
      ...(stored ?? {}),
      userId,
      companyName,
      hrEmail,
      updatedAt: stored?.updatedAt ?? "",
    };
  }

  /** the owner's language — what the hire's text and email are written in */
  async lang(userId: string): Promise<Lang> {
    const u = await this.users.get(userId).catch(() => null);
    return ownerLang(u);
  }

  private async text(
    to: string,
    body: string,
    what: string,
  ): Promise<boolean> {
    if (!to) return false;
    try {
      const r = await this.sms.send({ to, body });
      if (!r.ok) log(`${what}: text to ${to} failed: ${r.reason}`);
      return r.ok;
    } catch (e) {
      log(`${what}: text to ${to} failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** REQ-1003 — the business's From (REQ-628): its name as the display name, its alias as the
   *  address, so the hire's inbox names who is hiring them, never DocuMonster */
  private async fromFor(userId: string, companyName: string): Promise<string> {
    const identity = await this.identities.get(userId).catch(() => null);
    return newHireSender({ alias: identity?.emailAlias, company: companyName })
      .from;
  }

  private async mail(
    to: string,
    subject: string,
    htmlBody: string,
    what: string,
    sender: { from: string; replyTo?: string },
  ): Promise<boolean> {
    if (!to.trim()) return false;
    try {
      const r = await this.email.send({
        to,
        subject,
        htmlBody,
        from: sender.from,
        ...(sender.replyTo?.trim() ? { replyTo: sender.replyTo.trim() } : {}),
      });
      if (!r.ok) log(`${what}: email to ${to} failed: ${r.reason}`);
      return r.ok;
    } catch (e) {
      log(`${what}: email to ${to} failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** REQ-884b — the link by text + email; `reminder` is the 24-hour nudge (REQ-889b) */
  async sendLink(
    hire: Hire,
    kind: "invite" | "reminder" = "invite",
  ): Promise<{ sms: boolean; email: boolean }> {
    const [lang, s] = await Promise.all([
      this.lang(hire.userId),
      this.settingsFor(hire.userId),
    ]);
    const v = {
      first: hire.firstName,
      company: s.companyName || "the team",
      url: this.signUrl(hire.token, lang),
    };
    const smsKey = kind === "invite" ? "hr.sms.invite" : "hr.sms.reminder";
    const sms = await this.text(
      hire.phone,
      t(lang, smsKey, v),
      `${kind} ${hire.id}`,
    );
    const bodyKey = kind === "invite"
      ? "hr.email.inviteBody"
      : "hr.email.reminderBody";
    const subjectKey = kind === "invite"
      ? "hr.email.inviteSubject"
      : "hr.email.reminderSubject";
    const headlineKey = kind === "invite"
      ? "hr.email.inviteHeadline"
      : "hr.email.reminderHeadline";
    const from = await this.fromFor(hire.userId, s.companyName);
    const email = await this.mail(
      hire.email,
      t(lang, subjectKey, v),
      `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 8px">${escapeHtml(t(lang, headlineKey, v))}</h2>
<p>${escapeHtml(t(lang, bodyKey, v))}</p>
<p><a href="${
        escapeHtml(v.url)
      }" style="display:inline-block;background:#1a8e40;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:700">${
        escapeHtml(t(lang, "hr.email.inviteCta"))
      }</a></p>
<p style="color:#666;font-size:12px">${escapeHtml(v.url)}</p>
${
        s.hrEmail
          ? `<p style="color:#666;font-size:12px">${
            escapeHtml(t(lang, "hr.email.hrContact", { email: s.hrEmail }))
          }</p>`
          : ""
      }
</div>`,
      `${kind} ${hire.id}`,
      // a reply from the hire reaches HR, not the house inbox
      { from, replyTo: s.hrEmail },
    );
    return { sms, email };
  }

  /** REQ-889b — the HR address hears that a packet is complete */
  async notifyComplete(hire: Hire): Promise<boolean> {
    const [lang, s] = await Promise.all([
      this.lang(hire.userId),
      this.settingsFor(hire.userId),
    ]);
    if (!s.notifyOnComplete || !s.hrEmail) return false;
    const v = {
      name: fullName(hire),
      department: hire.departmentName,
      url: `${appUrl()}/hr/hires/${hire.id}`,
    };
    return await this.mail(
      s.hrEmail,
      t(lang, "hr.email.completeSubject", v),
      `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 8px">${
        escapeHtml(t(lang, "hr.email.completeHeadline", v))
      }</h2>
<p>${escapeHtml(t(lang, "hr.email.completeBody", v))}</p>
<p><a href="${escapeHtml(v.url)}">${
        escapeHtml(t(lang, "hr.email.completeCta"))
      }</a></p>
</div>`,
      `complete ${hire.id}`,
      { from: await this.fromFor(hire.userId, s.companyName) },
    );
  }

  /** REQ-889b — every due reminder, once each; the account's alone when `userId` is given */
  async sweepReminders(userId?: string): Promise<number> {
    const now = new Date().toISOString();
    const all = userId
      ? await this.hires.listByUser(userId)
      : await this.hires.listAll();
    let sent = 0;
    const settings = new Map<string, HrSettings>();
    for (const h of all) {
      if (!reminderDue(h, now)) continue;
      let s = settings.get(h.userId);
      if (!s) {
        s = await this.settingsFor(h.userId);
        settings.set(h.userId, s);
      }
      if (!s.remind24h) continue;
      // the record is written before the text, so a parallel sweep never doubles it
      const fresh = await this.hires.find(h.id);
      if (!fresh || fresh.mail.remindedAt) continue;
      await this.hires.put({
        ...fresh,
        mail: { ...fresh.mail, remindedAt: now },
        updatedAt: now,
      });
      await this.sendLink(fresh, "reminder");
      sent++;
    }
    return sent;
  }

  registerSweep(
    timer: Timer = (fn, ms) => setInterval(fn, ms) as unknown as number,
    unref: Unref = (id) => Deno.unrefTimer(id),
  ): boolean {
    try {
      const id = timer(() => {
        this.sweepReminders().catch((e) =>
          log(`sweep failed: ${(e as Error).message}`)
        );
      }, EVERY_MINUTE_MS);
      unref(id);
      return true;
    } catch (e) {
      log(`no minute sweep: ${(e as Error).message}; roster reads sweep`);
      return false;
    }
  }
}
