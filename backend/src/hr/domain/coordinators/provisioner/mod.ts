/**
 * REQ-888 / REQ-913 — MONSTERIZED: the provisioning engine. An arm per system in the plan (the
 * department's current connected systems, else the hire's snapshot). REQ-913: DocuMonster is the
 * source of truth — a built-in system (`dm-*`) is built HERE, in-process: the hire becomes a
 * Worker in Field, an editor of the account, gets the welcome email through Postmark, the welcome
 * text from the account's own line. A custom system with a webhook gets the hire POSTed to it
 * (2xx → ok, else fault with the reason); one without is manual until the admin marks it done.
 * Each arm's result stays on the hire; the status is `provisioning` until every arm is ok or
 * done, then `active`. No rollback — a half-built hire shows which arm failed and the admin
 * retries that one. Offboarding runs the same arms in reverse.
 */
import { Injectable } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { AccountAdminStore } from "@users/domain/data/account-admin-store/mod.ts";
import { AccountAdminError, AccountAdmins } from "@users/domain/coordinators/account-admins/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import { accountLabel, realName } from "@users/domain/business/account-admins/mod.ts";
import { appUrl } from "@users/domain/business/app-url/mod.ts";
import type { User } from "@users/dto/user.ts";
import { FieldWorkerStore, RegionStore } from "@field/domain/data/field-stores/mod.ts";
import { newWorkerLang, workerSignInUrl, workerWelcome } from "@field/domain/business/worker-welcome/mod.ts";
import type { FieldWorker } from "@field/dto/field.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { A2pUnregisteredError, SendText } from "@communications/domain/coordinators/send-text/mod.ts";
import { LineContext, NoLineError } from "@communications/domain/coordinators/line-context/mod.ts";
import { DepartmentStore, HireStore, HrSettingsStore, HrSystemStore } from "@hr/domain/data/hr-stores/mod.ts";
import { aggregateProvisioning, armMode, type BuiltinKey, fullName, provisionPlan } from "@hr/domain/business/onboarding/mod.ts";
import { escapeHtml } from "@hr/domain/coordinators/hr-notices/mod.ts";
import type { Hire, HrSystem, ProvisionResult } from "@hr/dto/hr.ts";

const WEBHOOK_TIMEOUT_MS = 10_000;
const log = (line: string) => console.log(`[hr/provisioner] ${line}`);

/** what a webhook sees: never the token */
export function hirePayload(h: Hire): Record<string, unknown> {
  return {
    id: h.id,
    firstName: h.firstName,
    lastName: h.lastName,
    name: fullName(h),
    email: h.email,
    phone: h.phone,
    departmentId: h.departmentId,
    departmentName: h.departmentName,
    startDate: h.startDate,
    status: h.status,
    signedAt: h.signedAt,
  };
}

/** the outcome of one arm: built, refused with a reason, or waiting on a human (with the reason) */
export type ArmOutcome = { ok: true; detail: string | null } | { ok: false; detail: string } | { manual: true; detail: string };

const digitsOf = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const randomPin = () => String(Math.floor(Math.random() * 10_000)).padStart(4, "0");

/** REQ-913 — the welcome copy, in the owner's language */
export function welcomeCopy(
  lang: "en" | "es",
  v: { first: string; company: string; portalUrl: string; username: string; password: string; startDate: string },
): { subject: string; html: string; text: string } {
  const creds = v.username || v.password;
  if (lang === "es") {
    const lines = [
      `Hola ${v.first}, ¡bienvenido/a a ${v.company}!`,
      v.startDate ? `Tu primer día es el ${v.startDate}.` : "",
      creds ? `Tu acceso al portal: ${v.portalUrl} — usuario ${v.username}, contraseña ${v.password}.` : "",
    ].filter(Boolean);
    return { subject: `Bienvenido/a a ${v.company}`, html: lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(""), text: lines.join(" ") };
  }
  const lines = [
    `Hi ${v.first}, welcome to ${v.company}!`,
    v.startDate ? `Your first day is ${v.startDate}.` : "",
    creds ? `Your portal login: ${v.portalUrl} — username ${v.username}, password ${v.password}.` : "",
  ].filter(Boolean);
  return { subject: `Welcome to ${v.company}`, html: lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(""), text: lines.join(" ") };
}

@Injectable()
export class Provisioner {
  /** test seam */
  fetchOverride: typeof fetch | null = null;

  constructor(
    private hires: HireStore,
    private depts: DepartmentStore,
    private systems: HrSystemStore,
    private users: UserStore,
    private identities: BusinessIdentityStore,
    private settings: HrSettingsStore,
    private workers: FieldWorkerStore,
    private regions: RegionStore,
    private admins: AccountAdmins,
    private adminStore: AccountAdminStore,
    private sms: SmsService,
    private email: EmailService,
    private sendText: SendText,
    private lineContext: LineContext,
  ) {}

  private async call(event: "hire.provision" | "hire.offboard", hire: Hire, sys: HrSystem): Promise<{ ok: boolean; detail: string | null }> {
    const f = this.fetchOverride ?? globalThis.fetch;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const res = await f(sys.webhookUrl!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event,
          hire: hirePayload(hire),
          system: { id: sys.id, key: sys.key, name: sys.name, kind: sys.kind },
          at: new Date().toISOString(),
        }),
        signal: ctl.signal,
      });
      const text = await res.text().catch(() => "");
      if (res.ok) return { ok: true, detail: text.slice(0, 200) || null };
      return { ok: false, detail: `webhook answered ${res.status}: ${text.slice(0, 200)}` };
    } catch (e) {
      return { ok: false, detail: `webhook failed: ${(e as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── REQ-913 — the built-in arms ────────────────────────────────────────────

  private async owner(hire: Hire): Promise<User> {
    return await this.users.get(hire.userId);
  }

  private async build(key: BuiltinKey, hire: Hire): Promise<ArmOutcome> {
    try {
      switch (key) {
        case "dm-worker":
          return await this.buildWorker(hire);
        case "dm-admin":
          return await this.buildEditor(hire);
        case "dm-email":
          return await this.sendWelcomeEmail(hire);
        case "dm-text":
          return await this.sendWelcomeText(hire);
      }
    } catch (e) {
      return { ok: false, detail: `${key} failed: ${(e as Error).message}` };
    }
  }

  private async tearDown(key: BuiltinKey, hire: Hire): Promise<{ ok: boolean; detail: string }> {
    try {
      switch (key) {
        case "dm-worker":
          return await this.removeWorker(hire);
        case "dm-admin":
          return await this.removeEditor(hire);
        case "dm-email":
        case "dm-text":
          return { ok: true, detail: "nothing to undo" };
      }
    } catch (e) {
      return { ok: false, detail: `${key} teardown failed: ${(e as Error).message}` };
    }
  }

  /** the hire becomes a Worker in Field (REQ-138's record), texted their PIN like any worker */
  private async buildWorker(hire: Hire): Promise<ArmOutcome> {
    const phone = digitsOf(hire.phone);
    if (phone.length < 10) return { ok: false, detail: "the hire has no 10-digit cell" };
    const existing = await this.workers.findByPhone(phone);
    if (existing && existing.userId === hire.userId) return { ok: true, detail: "already a worker" };
    if (existing) return { ok: false, detail: "that cell is already a worker in another account" };
    const owner = await this.owner(hire);
    const now = new Date().toISOString();
    const w: FieldWorker = {
      id: crypto.randomUUID(),
      userId: hire.userId,
      name: fullName(hire),
      phoneNumber: phone,
      pin: randomPin(),
      language: newWorkerLang(undefined, owner),
      createdAt: now,
      updatedAt: now,
    };
    await this.workers.put(w);
    const identity = await this.identities.get(owner.id).catch(() => null);
    const who = realName(owner.name);
    const biz = identity?.businessName?.trim();
    const lang = w.language ?? "es";
    const body = workerWelcome(lang, { owner: who && biz ? `${who} (${biz})` : accountLabel(owner, biz), url: workerSignInUrl(appUrl(), lang), pin: w.pin });
    const sent = await this.sms.send({ to: normalizePhone(w.phoneNumber), body }).catch((e) => ({ ok: false, reason: (e as Error).message }));
    return { ok: true, detail: sent.ok ? "worker account created; PIN texted" : `worker account created; PIN text failed: ${sent.reason ?? "unknown"}` };
  }

  private async removeWorker(hire: Hire): Promise<{ ok: boolean; detail: string }> {
    const w = await this.workers.findByPhone(digitsOf(hire.phone));
    if (!w || w.userId !== hire.userId) return { ok: true, detail: "no worker account to remove" };
    const zones = (await this.regions.listByUser(hire.userId)).filter((r) => r.workerId === w.id).map((r) => r.name);
    if (zones.length) return { ok: false, detail: `worker still covers zones (${zones.join(", ")}) — reassign them, then retry` };
    await this.workers.delete(w);
    return { ok: true, detail: "worker account removed" };
  }

  /** the hire is invited as an editor of the account (REQ-146) */
  private async buildEditor(hire: Hire): Promise<ArmOutcome> {
    const owner = await this.owner(hire);
    try {
      const rec = await this.admins.invite(owner, { phoneNumber: hire.phone, name: fullName(hire) });
      return { ok: true, detail: rec.texted ? "editor invited; sign-in texted" : "editor invited; the text did not go out" };
    } catch (e) {
      if (e instanceof AccountAdminError && e.message === "already_invited") return { ok: true, detail: "already an editor" };
      return { ok: false, detail: `editor invite refused: ${(e as Error).message}` };
    }
  }

  private async removeEditor(hire: Hire): Promise<{ ok: boolean; detail: string }> {
    let phone: string;
    try {
      phone = normalizePhone(hire.phone);
    } catch {
      return { ok: true, detail: "no editor to remove" };
    }
    const rec = await this.adminStore.find(phone, hire.userId);
    if (!rec) return { ok: true, detail: "no editor to remove" };
    await this.adminStore.delete(rec);
    return { ok: true, detail: "editor removed" };
  }

  private async copyFor(hire: Hire) {
    const [owner, stored, identity] = await Promise.all([
      this.owner(hire),
      this.settings.find(hire.userId),
      this.identities.get(hire.userId).catch(() => null),
    ]);
    const lang: "en" | "es" = owner.language === "es" ? "es" : "en";
    const company = stored?.companyName?.trim() || identity?.businessName?.trim() || owner.name?.trim() || "the team";
    return welcomeCopy(lang, {
      first: hire.firstName,
      company,
      portalUrl: appUrl(),
      username: stored?.credsUsername ?? "",
      password: stored?.credsPassword ?? "",
      startDate: hire.startDate,
    });
  }

  /** the welcome note, through the house EmailService (Postmark) */
  private async sendWelcomeEmail(hire: Hire): Promise<ArmOutcome> {
    if (!hire.email?.trim()) return { ok: false, detail: "the hire has no email address" };
    const copy = await this.copyFor(hire);
    const r = await this.email.send({ to: hire.email.trim(), subject: copy.subject, htmlBody: copy.html });
    return r.ok ? { ok: true, detail: `welcome email sent to ${hire.email.trim()}` } : { ok: false, detail: `welcome email failed: ${r.reason ?? "unknown"}` };
  }

  /** the same by text, from the account's own line (REQ-904); no line → a manual step that says so */
  private async sendWelcomeText(hire: Hire): Promise<ArmOutcome> {
    let line;
    try {
      line = await this.lineContext.forUser(hire.userId);
    } catch (e) {
      if (e instanceof NoLineError) return { manual: true, detail: "this account has no phone line yet — get one on the Phone page, or send the welcome by hand" };
      throw e;
    }
    const copy = await this.copyFor(hire);
    let r;
    try {
      r = await this.sendText.send({ to: hire.phone, body: copy.text }, line);
    } catch (e) {
      // REQ-920a: the line's texting registration is not approved yet
      if (e instanceof A2pUnregisteredError) return { manual: true, detail: "this number's texting registration isn't approved yet — finish it on the Phone page, or send the welcome by hand" };
      throw e;
    }
    return r.ok ? { ok: true, detail: `welcome text sent from ${line.number}` } : { ok: false, detail: `welcome text failed: ${r.reason ?? "unknown"}` };
  }

  // ── the run ────────────────────────────────────────────────────────────────

  private async plan(hire: Hire): Promise<HrSystem[]> {
    const [dept, systems] = await Promise.all([this.depts.find(hire.departmentId), this.systems.listByUser(hire.userId)]);
    return provisionPlan(hire, dept && dept.userId === hire.userId ? dept : null, systems);
  }

  /** REQ-888c — every arm, or one (`onlySystemId`, a retry) */
  async run(hire: Hire, onlySystemId?: string): Promise<Hire> {
    const plan = await this.plan(hire);
    const now = new Date().toISOString();
    const results: ProvisionResult[] = [];
    for (const sys of plan) {
      const prev = hire.provisioning.find((r) => r.systemId === sys.id);
      if (onlySystemId && sys.id !== onlySystemId && prev) {
        results.push(prev);
        continue;
      }
      if (prev && (prev.state === "ok" || prev.state === "done") && !onlySystemId) {
        results.push(prev); // never rebuild what stands
        continue;
      }
      const mode = armMode(sys);
      if (mode === "manual") {
        results.push({ systemId: sys.id, name: sys.name, state: prev?.state === "done" ? "done" : "manual", detail: null, at: now });
        continue;
      }
      if (mode === "builtin") {
        const r = await this.build(sys.key as BuiltinKey, hire);
        const state = "manual" in r ? (prev?.state === "done" ? "done" : "manual") : r.ok ? "ok" : "fault";
        results.push({ systemId: sys.id, name: sys.name, state, detail: r.detail, at: new Date().toISOString() });
        if (state === "fault") log(`${hire.id} ${sys.name}: ${r.detail}`);
        continue;
      }
      const r = await this.call("hire.provision", hire, sys);
      results.push({ systemId: sys.id, name: sys.name, state: r.ok ? "ok" : "fault", detail: r.detail, at: new Date().toISOString() });
      if (!r.ok) log(`${hire.id} ${sys.name}: ${r.detail}`);
    }
    return await this.settle(hire, results);
  }

  /** REQ-888c — a manual arm the admin built by hand */
  async markDone(hire: Hire, systemId: string): Promise<Hire | null> {
    const idx = hire.provisioning.findIndex((r) => r.systemId === systemId);
    if (idx < 0) return null;
    const results = hire.provisioning.map((r, i) => i === idx ? { ...r, state: "done" as const, at: new Date().toISOString() } : r);
    return await this.settle(hire, results);
  }

  private async settle(hire: Hire, results: ProvisionResult[]): Promise<Hire> {
    const now = new Date().toISOString();
    const status = aggregateProvisioning(results);
    return await this.hires.put({
      ...hire,
      provisioning: results,
      status,
      activeAt: status === "active" ? (hire.activeAt ?? now) : hire.activeAt,
      updatedAt: now,
    });
  }

  /** REQ-888d — the same arms in reverse: every built account is torn down */
  async offboard(hire: Hire): Promise<Hire> {
    const systems = await this.systems.listByUser(hire.userId);
    const results: ProvisionResult[] = [];
    for (const r of hire.provisioning) {
      if (r.state !== "ok" && r.state !== "done") {
        results.push(r);
        continue;
      }
      const sys = systems.find((s) => s.id === r.systemId);
      const mode = sys ? armMode(sys) : "manual";
      if (mode === "builtin") {
        const c = await this.tearDown(sys!.key as BuiltinKey, hire);
        results.push({ ...r, state: c.ok ? "torn_down" : "teardown_fault", detail: c.detail, at: new Date().toISOString() });
        continue;
      }
      if (mode === "manual") {
        results.push({ ...r, state: "torn_down", detail: "offboarded — deactivate by hand", at: new Date().toISOString() });
        continue;
      }
      const c = await this.call("hire.offboard", hire, sys!);
      results.push({ ...r, state: c.ok ? "torn_down" : "teardown_fault", detail: c.detail, at: new Date().toISOString() });
    }
    const now = new Date().toISOString();
    return await this.hires.put({ ...hire, provisioning: results, status: "offboarded", offboardedAt: now, updatedAt: now });
  }
}
