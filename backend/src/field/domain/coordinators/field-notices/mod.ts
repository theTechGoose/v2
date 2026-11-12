/**
 * REQ-171/172 — the field's texts, through the existing SmsService: a worker's new job today,
 * a customer's canceled or deferred service, and the 9 am "you're on today's schedule" sweep.
 * Every text is recorded in KV first (by kind and task, or by account + day + customer), so a
 * retry, a second click or a restarted isolate never sends it twice. Nothing here throws into a
 * route: a failed text is a log line and `false`.
 */
import { featureOn } from "#features";
import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { businessTimezone } from "@users/domain/business/timezone/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import {
  accountLabel,
  realName,
} from "@users/domain/business/account-admins/mod.ts";
import { outboundSenderName } from "#quote-flow/outbound-identity.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import {
  FieldWorkerStore,
  SubscriptionStore,
  TaskTypeStore,
} from "@field/domain/data/field-stores/mod.ts";
import { FieldDay } from "@field/domain/coordinators/field-day/mod.ts";
import {
  customerCanceledText,
  customerDeferredText,
  customerTodayText,
  type NoticeLang,
  scheduleDue,
  servicesLine,
  workerNewTaskText,
} from "@field/domain/business/notices/mod.ts";
import { todayIn } from "@field/domain/business/schedule/mod.ts";
import type { FieldTask } from "@field/dto/field.ts";

const EVERY_MINUTE_MS = 60_000;
type Timer = (fn: () => void, ms: number) => number;
type Unref = (id: number) => void;

interface Sender {
  /** the business's outbound name — what a customer's text is signed with */
  business: string;
  /** "Alexander Jerez (A2Z Landscape LLC)" — what a worker's text names */
  owner: string;
  /** the owner's own language (workers) */
  ownerLang: NoticeLang;
  /** the business's comms language (customers) */
  commsLang: NoticeLang;
  tz: string;
}

const log = (line: string) => console.log(`[field/notices] ${line}`);

@Injectable()
export class FieldNotices {
  constructor(
    private users: UserStore,
    private identities: BusinessIdentityStore,
    private customers: CustomerStore,
    private workers: FieldWorkerStore,
    private types: TaskTypeStore,
    private subs: SubscriptionStore,
    private day: FieldDay,
    private sms: SmsService,
    private addresses: BusinessAddressStore = new BusinessAddressStore(),
  ) {}

  /** REQ-172/255 — the zone the 9 am texts follow: the one picked, else the address's state's, else New York */
  private async zone(
    userId: string,
    timezone: string | undefined,
  ): Promise<string> {
    const address = await this.addresses.get(userId).catch(() => null);
    return businessTimezone({ timezone, state: address?.state });
  }

  /** who signs the text; null (logged) when the account still carries a placeholder name */
  private async sender(userId: string): Promise<Sender | null> {
    const user = await this.users.get(userId).catch(() => null);
    if (!user) return null;
    if (!featureOn(user.features, "fieldTexts")) {
      log(`account ${userId}: fieldTexts is off — no text (REQ-177)`);
      return null;
    }
    const identity = await this.identities.get(userId).catch(() => null);
    const biz = identity?.businessName?.trim();
    const business = outboundSenderName({
      userName: user.name,
      businessName: biz ?? identity?.legalName,
    });
    if (!business) {
      log(`account ${userId} has no sender name yet — no text`);
      return null;
    }
    const who = realName(user.name);
    const owner = who && biz ? `${who} (${biz})` : accountLabel(user, biz);
    return {
      business: biz || business,
      owner,
      ownerLang: user.language === "es" ? "es" : "en",
      commsLang: identity?.commsLanguage === "es" ? "es" : "en",
      tz: await this.zone(userId, identity?.timezone),
    };
  }

  /** true the first time this key is seen — the record is written before any text goes out */
  private async once(key: Deno.KvKey): Promise<boolean> {
    const kv = await getKv();
    const r = await kv.atomic().check({ key, versionstamp: null }).set(
      key,
      new Date().toISOString(),
    ).commit();
    return r.ok;
  }

  private async text(
    to: string | undefined,
    body: string,
    what: string,
  ): Promise<boolean> {
    let phone: string;
    try {
      phone = normalizePhone(to ?? "");
    } catch {
      log(`${what}: no usable phone number — skipped`);
      return false;
    }
    try {
      const r = await this.sms.send({ to: phone, body });
      if (!r.ok) log(`${what}: text to ${phone} failed: ${r.reason}`);
      return r.ok;
    } catch (e) {
      log(`${what}: text to ${phone} failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** REQ-171: a worker hears about a job added to (or moved onto) their list TODAY */
  async workerNewTask(userId: string, task: FieldTask): Promise<boolean> {
    const s = await this.sender(userId);
    if (!s) return false;
    if (task.date !== todayIn(s.tz)) return false;
    if (
      !await this.once(["field_notice", "worker-new", task.id, task.workerId])
    ) return false;
    const [w, types, customer] = await Promise.all([
      this.workers.find(task.workerId),
      this.types.listByUser(userId),
      this.customers.get(task.customerId).catch(() => null),
    ]);
    if (!w || w.userId !== userId) return false;
    const body = workerNewTaskText(s.ownerLang, {
      owner: s.owner,
      type: types.find((x) => x.id === task.taskTypeId)?.name ?? "—",
      customer: customer?.name ?? "—",
      address: task.address ?? "",
    });
    return this.text(
      w.phoneNumber,
      body,
      `worker ${w.name} new task ${task.id}`,
    );
  }

  /** REQ-171: a customer hears that a service on or after today was canceled */
  async customerCanceled(userId: string, task: FieldTask): Promise<boolean> {
    const s = await this.sender(userId);
    if (!s) return false;
    if (task.date < todayIn(s.tz)) return false;
    if (!await this.once(["field_notice", "canceled", task.id])) return false;
    const [types, customer] = await Promise.all([
      this.types.listByUser(userId),
      this.customers.get(task.customerId).catch(() => null),
    ]);
    const body = customerCanceledText(s.commsLang, {
      business: s.business,
      service: types.find((x) => x.id === task.taskTypeId)?.name ?? "—",
      date: task.date,
    });
    return this.text(
      customer?.phoneNumber,
      body,
      `customer ${customer?.name ?? task.customerId} canceled ${task.id}`,
    );
  }

  /** REQ-171: a customer hears their service moved to another day */
  async customerDeferred(
    userId: string,
    task: FieldTask,
    to: string,
  ): Promise<boolean> {
    const s = await this.sender(userId);
    if (!s) return false;
    if (!await this.once(["field_notice", "deferred", task.id, to])) {
      return false;
    }
    const [types, customer] = await Promise.all([
      this.types.listByUser(userId),
      this.customers.get(task.customerId).catch(() => null),
    ]);
    const body = customerDeferredText(s.commsLang, {
      business: s.business,
      service: types.find((x) => x.id === task.taskTypeId)?.name ?? "—",
      from: task.date,
      to,
    });
    return this.text(
      customer?.phoneNumber,
      body,
      `customer ${customer?.name ?? task.customerId} deferred ${task.id}`,
    );
  }

  /** every account with subscriptions — the ones a schedule text can concern */
  private async accounts(): Promise<string[]> {
    const kv = await getKv();
    const ids = new Set<string>();
    for await (const e of kv.list({ prefix: ["field_subscription_by_user"] })) {
      const userId = e.key[1];
      if (typeof userId === "string") ids.add(userId);
    }
    return [...ids];
  }

  /** REQ-172: once the business's clock reads 09:00, every customer with open work that day hears once */
  async sweep(now = new Date()): Promise<{ accounts: number; texted: number }> {
    let texted = 0;
    const accounts = await this.accounts();
    for (const userId of accounts) {
      try {
        texted += await this.sweepAccount(userId, now);
      } catch (e) {
        log(`sweep ${userId} failed: ${(e as Error).message}`);
      }
    }
    return { accounts: accounts.length, texted };
  }

  private async sweepAccount(userId: string, now: Date): Promise<number> {
    const identity = await this.identities.get(userId).catch(() => null);
    const tz = await this.zone(userId, identity?.timezone);
    const kv = await getKv();
    const sentForDate =
      (await kv.get<string>(["field_notice", "schedule-day", userId])).value ??
        undefined;
    const date = scheduleDue({ tz, now, sentForDate });
    if (!date) return 0;
    const s = await this.sender(userId);
    await kv.set(["field_notice", "schedule-day", userId], date); // the day is claimed even when nothing can go out
    if (!s) return 0;
    const round = (await this.day.generate(userId, date)).all.filter((t) =>
      t.status === "assigned"
    );
    if (!round.length) return 0;
    const types = new Map(
      (await this.types.listByUser(userId)).map((x) => [x.id, x.name]),
    );
    const byCustomer = new Map<string, FieldTask[]>();
    for (const t of round) {
      byCustomer.set(t.customerId, [
        ...(byCustomer.get(t.customerId) ?? []),
        t,
      ]);
    }
    let n = 0;
    for (const [customerId, tasks] of byCustomer) {
      if (
        !await this.once(["field_notice", "today", userId, date, customerId])
      ) continue;
      const customer = await this.customers.get(customerId).catch(() => null);
      const body = customerTodayText(s.commsLang, {
        business: s.business,
        services: servicesLine(
          tasks.map((t) => types.get(t.taskTypeId) ?? "—"),
        ),
      });
      if (
        await this.text(
          customer?.phoneNumber,
          body,
          `customer ${customer?.name ?? customerId} schedule ${date}`,
        )
      ) n++;
    }
    return n;
  }

  /** REQ-172 (REQ-074's pattern): a minute timer while the isolate lives — never Deno.cron; never throws */
  registerSweep(
    timer: Timer = (fn, ms) => setInterval(fn, ms) as unknown as number,
    unref: Unref = (id) => Deno.unrefTimer(id),
  ): boolean {
    try {
      const id = timer(() => {
        void this.sweep();
      }, EVERY_MINUTE_MS);
      unref(id);
      return true;
    } catch (e) {
      log(`no minute sweep: ${(e as Error).message}`);
      return false;
    }
  }
}
