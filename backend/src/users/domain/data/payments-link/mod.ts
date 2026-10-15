// REQ-054 — the CRM's link builder, from this app's side: a customer, the first month as a due,
// the pay link that collects it, and whether the due still reads open. Real against ppwk-crm's
// payments API when PPWK_PAYMENTS_URL + PPWK_PAYMENTS_TOKEN + PPWK_PAYMENTS_ACCOUNT are set;
// otherwise the in-process fake the gate's lanes run on (the same way EmailService runs without
// a Postmark key).
// REQ-069 — the CRM (its REQ-091) takes the merchant account as the `x-account` request header
// on every mint and every subscription, required: PPWK_PAYMENTS_ACCOUNT names it, and a pick
// that names its own merchant (REQ-064) rides that header instead. Nothing about the account is
// in the body any more.
// REQ-058 — a customer carries this app's ref: the CRM upserts by it (ppwk-crm REQ-076), so
// sign-up, onboarding and every later edit talk about ONE record, read back with findCustomer.
// REQ-059 — a pay link carries the address the receipt brings the person back to (REQ-077 there).
import { Injectable } from "#danet/core";
import { type PaymentsLinkName, selectPaymentsLinkName } from "@users/domain/business/payments-link-select/mod.ts";
import { addMonth, monthLabel } from "@users/domain/business/plan/mod.ts";

export interface NewCustomer {
  customerName: string;
  /** "" when the account has none yet — allowed with an externalRef (the CRM's REQ-076) */
  customerEmail: string;
  customerPhone?: string;
  /** this app's ref for the account (externalRefFor): the CRM upserts by it */
  externalRef?: string;
  /** REQ-062 — the CRM's tier for this person (its Quickbase Customers.Tier): Lead, or the plan's name */
  tier?: string;
  /** REQ-070 — the profile the CRM's lead columns show (its REQ-098): the person, the business's city and
   *  state, its website, and where they came from; each only when the account has it */
  contact?: string;
  city?: string;
  state?: string;
  website?: string;
  leadSource?: string;
}
/** what the CRM holds for a customer, as this app reads it back */
export interface CrmCustomer extends NewCustomer {
  customerId: string;
  /** when the CRM made the record (REQ-060: a lead captured at login is older than its sign-up) */
  createdAt?: string;
}
export interface NewDue {
  customerId: string;
  amountCents: number;
  memo: string;
}
export interface NewPayLink {
  customerId: string;
  dueId: string;
  /** REQ-059 — where the receipt goes back to, and what it calls that place */
  returnUrl?: string;
  returnLabel?: string;
  /** REQ-064 — the merchant account the charge goes through (the CRM's `x-account`, REQ-069); absent = PPWK_PAYMENTS_ACCOUNT */
  merchant?: string;
}
/** REQ-061 — a monthly billing on the CRM (its REQ-081): the amount, what it is for, this app's
 *  handle, when the first recurring month falls due, and where a recovery link brings the person back */
export interface NewSubscription {
  customerId: string;
  amountCents: number;
  memo: string;
  externalRef: string;
  firstBillAt: string;
  returnUrl?: string;
  returnLabel?: string;
  /** REQ-064 — the merchant account the months go through (the CRM's `x-account`, REQ-069); absent = PPWK_PAYMENTS_ACCOUNT */
  merchant?: string;
}
export type SubscriptionStatus = "active" | "past_due" | "canceled";
export interface SubscriptionInfo {
  subscriptionId: string;
  status: SubscriptionStatus;
  /** when the next month falls due; the month being retried while past due */
  nextBillAt: string;
  lastBilledAt: string;
  cardBrand: string;
  cardLast4: string;
  failures: number;
  /** while past due: the pay page for the month (absolute); "" otherwise */
  payUrl: string;
}
export interface PaymentsLinkPort {
  /** make the customer — or, with an externalRef the CRM already knows, revise that one */
  createCustomer(input: NewCustomer): Promise<{ customerId: string }>;
  /** the customer carrying this ref; null when the CRM has none */
  findCustomer(externalRef: string): Promise<CrmCustomer | null>;
  raiseDue(input: NewDue): Promise<{ dueId: string }>;
  mintPayLink(input: NewPayLink): Promise<{ payUrl: string }>;
  /** does the CRM's ledger still say something is outstanding on this due */
  dueOpen(dueId: string): Promise<boolean>;
  /** REQ-061 — start billing monthly; the CRM's clock does the rest */
  startSubscription(input: NewSubscription): Promise<{ subscriptionId: string }>;
  /** the newest subscription under this app's handle; null when none */
  findSubscription(externalRef: string): Promise<SubscriptionInfo | null>;
  /** one subscription as it stands; null when the CRM has none by that id */
  subscription(subscriptionId: string): Promise<SubscriptionInfo | null>;
  /** stop billing (a downgrade, a switch of plan) */
  cancelSubscription(subscriptionId: string, reason: string): Promise<void>;
}

/** the CRM's doors this client knocks on (ppwk-crm payments, REQ-057/076/077 there) */
const CUSTOMERS = "/api/payments/customers";
const DUES = "/api/payments/dues";
const PAY_LINKS = "/api/payments/pay-links";
const SUBSCRIPTIONS = "/api/payments/subscriptions";
const CATEGORY = "sales";

class PaymentsUnavailableError extends Error {
  readonly status = 502;
  constructor(detail: string) {
    super(`payments-unavailable: ${detail}`);
    this.name = "PaymentsUnavailableError";
  }
}

/** the real one: ppwk-crm's payments API behind the operator token; `account` is the merchant
 *  account (PPWK_PAYMENTS_ACCOUNT) every charge goes through unless a call names its own (REQ-069) */
class CrmPaymentsLink implements PaymentsLinkPort {
  constructor(private readonly origin: string, private readonly token: string, private readonly account: string, private readonly f: typeof fetch = globalThis.fetch) {}

  private async send(method: string, path: string, body?: unknown, account?: string): Promise<Response> {
    try {
      return await this.f(`${this.origin}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          ...(account ? { "x-account": account } : {}), // REQ-069 — the CRM's merchant account, on the calls that charge
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new PaymentsUnavailableError(`${method} ${path}: ${String(e)}`);
    }
  }
  private async call<T>(method: string, path: string, body?: unknown, account?: string): Promise<T> {
    const res = await this.send(method, path, body, account);
    const text = await res.text();
    if (!res.ok) throw new PaymentsUnavailableError(`${method} ${path} answered ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  }

  async createCustomer(input: NewCustomer) {
    const c = await this.call<{ customerId: string }>("POST", CUSTOMERS, input);
    return { customerId: c.customerId };
  }
  async findCustomer(externalRef: string) {
    const res = await this.send("GET", `${CUSTOMERS}/by-external/${encodeURIComponent(externalRef)}`);
    const text = await res.text();
    if (res.status === 404) return null;
    if (!res.ok) throw new PaymentsUnavailableError(`GET customers/by-external answered ${res.status}: ${text.slice(0, 200)}`);
    const c = JSON.parse(text) as CrmCustomer;
    return { customerId: c.customerId, customerName: c.customerName, customerEmail: c.customerEmail, customerPhone: c.customerPhone, externalRef: c.externalRef, ...(c.tier ? { tier: c.tier } : {}), ...(c.createdAt ? { createdAt: c.createdAt } : {}) };
  }
  async raiseDue(input: NewDue) {
    const d = await this.call<{ dueId: string }>("POST", DUES, { ...input, categoryCode: CATEGORY });
    return { dueId: d.dueId };
  }
  async mintPayLink(input: NewPayLink) {
    const { merchant, ...link } = input;
    const l = await this.call<{ chargeUrl: string }>("POST", PAY_LINKS, { ...link, brandId: "" }, merchant || this.account);
    return { payUrl: `${this.origin}${l.chargeUrl}` };
  }
  async dueOpen(dueId: string) {
    const d = await this.call<{ open: boolean }>("GET", `${DUES}/${encodeURIComponent(dueId)}`);
    return d.open === true;
  }
  // REQ-061 — the CRM's subscriptions (its REQ-081); its payUrl is a path on its origin
  async startSubscription(input: NewSubscription) {
    const s = await this.call<{ subscriptionId: string }>("POST", SUBSCRIPTIONS, {
      customerId: input.customerId,
      amountCents: input.amountCents,
      categoryCode: CATEGORY,
      memo: input.memo,
      externalRef: input.externalRef,
      firstBillAt: input.firstBillAt,
      brandId: "",
      returnUrl: input.returnUrl ?? "",
      returnLabel: input.returnLabel ?? "",
    }, input.merchant || this.account); // REQ-064/069 — the pick's merchant, else the configured account
    return { subscriptionId: s.subscriptionId };
  }
  async findSubscription(externalRef: string) {
    return await this.readSubscription(`${SUBSCRIPTIONS}/by-external/${encodeURIComponent(externalRef)}`);
  }
  async subscription(subscriptionId: string) {
    return await this.readSubscription(`${SUBSCRIPTIONS}/${encodeURIComponent(subscriptionId)}`);
  }
  async cancelSubscription(subscriptionId: string, reason: string) {
    await this.call("POST", `${SUBSCRIPTIONS}/${encodeURIComponent(subscriptionId)}/cancel`, { subscriptionId, reason });
  }
  private async readSubscription(path: string): Promise<SubscriptionInfo | null> {
    const res = await this.send("GET", path);
    const text = await res.text();
    if (res.status === 404) return null;
    if (!res.ok) throw new PaymentsUnavailableError(`GET ${path} answered ${res.status}: ${text.slice(0, 200)}`);
    const s = JSON.parse(text) as SubscriptionInfo;
    return {
      subscriptionId: s.subscriptionId,
      status: s.status,
      nextBillAt: s.nextBillAt,
      lastBilledAt: s.lastBilledAt,
      cardBrand: s.cardBrand,
      cardLast4: s.cardLast4,
      failures: s.failures,
      payUrl: s.payUrl ? `${this.origin}${s.payUrl}` : "",
    };
  }
}

/** the fake's world — what a story or an int test reads back and settles */
export interface FakeSubscription extends NewSubscription, SubscriptionInfo {}

class FakePaymentsWorld {
  customers: CrmCustomer[] = [];
  dues: Array<NewDue & { dueId: string; open: boolean }> = [];
  links: Array<NewPayLink & { payUrl: string }> = [];
  /** REQ-061 — the CRM's subscriptions, and the card its pay page put on file per customer */
  subscriptions: FakeSubscription[] = [];
  cards = new Map<string, { cardBrand: string; cardLast4: string }>();
  reset() {
    this.customers = [];
    this.dues = [];
    this.links = [];
    this.subscriptions = [];
    this.cards.clear();
  }
  /** the card landed: what the real pay page does to the due — and the card is on file now;
   *  a past-due month paid this way makes its subscription current again (the CRM's REQ-081) */
  settle(dueId: string) {
    const due = this.dues.find((d) => d.dueId === dueId);
    if (!due) throw Object.assign(new Error(`due-missing: ${dueId}`), { status: 404 });
    due.open = false;
    this.cards.set(due.customerId, { cardBrand: "visa", cardLast4: "1111" });
    const now = new Date().toISOString();
    for (const s of this.subscriptions) {
      if (s.status === "past_due" && s.payUrl.includes(`due=${dueId}`)) {
        Object.assign(s, { status: "active", nextBillAt: addMonth(s.nextBillAt), lastBilledAt: now, payUrl: "", failures: 0, ...this.cards.get(s.customerId) });
      }
    }
  }
  /** the card is gone (expired, revoked): the next month cannot be collected */
  dropCard(customerId: string) {
    this.cards.delete(customerId);
  }
  /**
   * REQ-061 — the CRM's clock (its REQ-081), as the fake: every subscription whose month has come
   * is charged to the card on file and moves on a month; with no card the month is past due,
   * with a pay page for it (the app's own stand-in) that returns where the subscription says.
   */
  bill(now: string) {
    for (const s of this.subscriptions) {
      if (s.status === "canceled") continue;
      if (s.status === "active" && s.nextBillAt > now) continue;
      const card = this.cards.get(s.customerId);
      if (card) {
        Object.assign(s, { status: "active", nextBillAt: addMonth(s.nextBillAt), lastBilledAt: now, payUrl: "", failures: 0, ...card });
        continue;
      }
      if (s.status !== "past_due") {
        const dueId = crypto.randomUUID();
        this.dues.push({ customerId: s.customerId, amountCents: s.amountCents, memo: `${s.memo} — ${monthLabel(s.nextBillAt)}`, dueId, open: true });
        const q = new URLSearchParams({ customer: s.customerId, due: dueId });
        if (s.returnUrl) {
          q.set("return", s.returnUrl);
          q.set("label", s.returnLabel ?? "");
        }
        s.payUrl = `${fakePayPageOrigin()}/pay/fake?${q}`;
      }
      s.status = "past_due";
      s.failures += 1;
    }
  }
}
const WORLD = new FakePaymentsWorld();
export function fakePaymentsWorld(): FakePaymentsWorld {
  return WORLD;
}

/** the app's own url: APP_URL (the launcher's frontend; the public origin in production), the
 *  dev default otherwise — the same rule the alert links use */
export function appOrigin(): string {
  const explicit = Deno.env.get("APP_URL")?.trim() || undefined;
  return (explicit ?? "http://localhost:5280").replace(/\/+$/, "");
}

/** where the fake's pay page lives: the app itself — only ever a local one (the fake never runs
 *  in production, REQ-054) */
function fakePayPageOrigin(): string {
  const origin = appOrigin();
  return /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(origin) ? origin : "http://localhost:5280";
}

class FakePaymentsLink implements PaymentsLinkPort {
  constructor(private readonly world = WORLD) {}
  createCustomer(input: NewCustomer) {
    // REQ-058 — the CRM's upsert (its REQ-076): a ref it knows revises that customer in place
    const ref = input.externalRef?.trim() ?? "";
    const known = ref ? this.world.customers.find((c) => c.externalRef === ref) : undefined;
    if (known) {
      Object.assign(known, { ...input, customerId: known.customerId, createdAt: known.createdAt });
      return Promise.resolve({ customerId: known.customerId });
    }
    // REQ-060 — the CRM's lead rule (its REQ-082): a phone alone is a lead; the ref that later
    // arrives with the same phone CLAIMS it; a bare phone post for a phone already here changes nothing
    const phone = input.customerPhone?.trim() ?? "";
    const byPhone = phone ? this.world.customers.find((c) => c.customerPhone === phone) : undefined;
    if (byPhone) {
      if (ref === "") return Promise.resolve({ customerId: byPhone.customerId });
      if (!byPhone.externalRef) {
        Object.assign(byPhone, { ...input, customerId: byPhone.customerId, createdAt: byPhone.createdAt });
        return Promise.resolve({ customerId: byPhone.customerId });
      }
    }
    const customerId = crypto.randomUUID();
    this.world.customers.push({ ...input, customerId, createdAt: new Date().toISOString() });
    return Promise.resolve({ customerId });
  }
  findCustomer(externalRef: string) {
    const found = this.world.customers.find((c) => c.externalRef === externalRef);
    return Promise.resolve(found ? { ...found } : null);
  }
  raiseDue(input: NewDue) {
    const dueId = crypto.randomUUID();
    this.world.dues.push({ ...input, dueId, open: true });
    return Promise.resolve({ dueId });
  }
  mintPayLink(input: NewPayLink) {
    // REQ-057 — the app's own stand-in pay page (front-end/routes/pay/fake.tsx), the shape the
    // real link builder makes: a page carrying the customer's ref and the due, at the app's url.
    // REQ-059 — and the return address the receipt follows, as the real page's does.
    const q = new URLSearchParams({ customer: input.customerId, due: input.dueId });
    if (input.returnUrl) {
      q.set("return", input.returnUrl);
      q.set("label", input.returnLabel ?? "");
    }
    if (input.merchant) q.set("merchant", input.merchant); // REQ-064 — on the page's url, as the CRM's link carries it
    const payUrl = `${fakePayPageOrigin()}/pay/fake?${q}`;
    this.world.links.push({ ...input, payUrl });
    return Promise.resolve({ payUrl });
  }
  dueOpen(dueId: string) {
    const due = this.world.dues.find((d) => d.dueId === dueId);
    return Promise.resolve(due ? due.open : false);
  }
  // REQ-061 — the CRM's subscriptions, as the fake (its clock is world.bill)
  startSubscription(input: NewSubscription) {
    // the card the pay page just put on file is the one the months will go to (the CRM says so from the start)
    const card = this.world.cards.get(input.customerId) ?? { cardBrand: "", cardLast4: "" };
    const sub: FakeSubscription = {
      ...input,
      subscriptionId: crypto.randomUUID(),
      status: "active",
      nextBillAt: new Date(input.firstBillAt).toISOString(),
      lastBilledAt: "",
      ...card,
      failures: 0,
      payUrl: "",
    };
    this.world.subscriptions.push(sub);
    return Promise.resolve({ subscriptionId: sub.subscriptionId });
  }
  findSubscription(externalRef: string) {
    const mine = this.world.subscriptions.filter((s) => s.externalRef === externalRef);
    return Promise.resolve(mine.length ? info(mine[mine.length - 1]) : null);
  }
  subscription(subscriptionId: string) {
    const found = this.world.subscriptions.find((s) => s.subscriptionId === subscriptionId);
    return Promise.resolve(found ? info(found) : null);
  }
  cancelSubscription(subscriptionId: string, _reason: string) {
    const found = this.world.subscriptions.find((s) => s.subscriptionId === subscriptionId);
    if (!found) throw Object.assign(new Error(`subscription-missing: ${subscriptionId}`), { status: 404 });
    found.status = "canceled";
    found.payUrl = "";
    return Promise.resolve();
  }
}

function info(s: FakeSubscription): SubscriptionInfo {
  return { subscriptionId: s.subscriptionId, status: s.status, nextBillAt: s.nextBillAt, lastBilledAt: s.lastBilledAt, cardBrand: s.cardBrand, cardLast4: s.cardLast4, failures: s.failures, payUrl: s.payUrl };
}

/**
 * real when both env keys are set, the fake otherwise — decided per call, so a test can flip it.
 * In production (DENO_DEPLOYMENT_ID set) a missing key throws at boot instead of binding the
 * fake, the REQ-001 rule: selectPaymentsLinkName.
 */
@Injectable()
export class PaymentsLink implements PaymentsLinkPort {
  /** test seam for the real client's HTTP, like EmailService.fetchOverride */
  fetchOverride: typeof fetch | null = null;
  /** test seam for the whole door (REQ-072): a port that stands in for the CRM on this instance,
   *  so a test never has to flip the process-wide env that selects the real client */
  portOverride: PaymentsLinkPort | null = null;

  constructor() {
    this.which();
  }
  private which(): PaymentsLinkName {
    return selectPaymentsLinkName({
      PPWK_PAYMENTS_URL: Deno.env.get("PPWK_PAYMENTS_URL"),
      PPWK_PAYMENTS_TOKEN: Deno.env.get("PPWK_PAYMENTS_TOKEN"),
      PPWK_PAYMENTS_ACCOUNT: Deno.env.get("PPWK_PAYMENTS_ACCOUNT"),
      DENO_DEPLOYMENT_ID: Deno.env.get("DENO_DEPLOYMENT_ID"),
    });
  }
  isFake(): boolean {
    return this.which() === "fake";
  }
  private port(): PaymentsLinkPort {
    if (this.portOverride) return this.portOverride;
    if (this.which() === "fake") return new FakePaymentsLink();
    const origin = (Deno.env.get("PPWK_PAYMENTS_URL") ?? "").trim().replace(/\/+$/, "");
    const token = (Deno.env.get("PPWK_PAYMENTS_TOKEN") ?? "").trim();
    const account = (Deno.env.get("PPWK_PAYMENTS_ACCOUNT") ?? "").trim();
    return new CrmPaymentsLink(origin, token, account, this.fetchOverride ?? globalThis.fetch);
  }
  createCustomer(input: NewCustomer) {
    return this.port().createCustomer(input);
  }
  findCustomer(externalRef: string) {
    return this.port().findCustomer(externalRef);
  }
  raiseDue(input: NewDue) {
    return this.port().raiseDue(input);
  }
  mintPayLink(input: NewPayLink) {
    return this.port().mintPayLink(input);
  }
  dueOpen(dueId: string) {
    return this.port().dueOpen(dueId);
  }
  startSubscription(input: NewSubscription) {
    return this.port().startSubscription(input);
  }
  findSubscription(externalRef: string) {
    return this.port().findSubscription(externalRef);
  }
  subscription(subscriptionId: string) {
    return this.port().subscription(subscriptionId);
  }
  cancelSubscription(subscriptionId: string, reason: string) {
    return this.port().cancelSubscription(subscriptionId, reason);
  }
}
