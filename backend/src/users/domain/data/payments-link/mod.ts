// REQ-054 — the CRM's link builder, from this app's side: a customer, the first month as a due,
// the pay link that collects it, and whether the due still reads open. Real against ppwk-crm's
// payments API when PPWK_PAYMENTS_URL + PPWK_PAYMENTS_TOKEN are set; otherwise the in-process
// fake the gate's lanes run on (the same way EmailService runs without a Postmark key).
// REQ-058 — a customer carries this app's ref: the CRM upserts by it (ppwk-crm REQ-076), so
// sign-up, onboarding and every later edit talk about ONE record, read back with findCustomer.
// REQ-059 — a pay link carries the address the receipt brings the person back to (REQ-077 there).
import { Injectable } from "#danet/core";
import { type PaymentsLinkName, selectPaymentsLinkName } from "@users/domain/business/payments-link-select/mod.ts";

export interface NewCustomer {
  customerName: string;
  /** "" when the account has none yet — allowed with an externalRef (the CRM's REQ-076) */
  customerEmail: string;
  customerPhone?: string;
  /** this app's ref for the account (externalRefFor): the CRM upserts by it */
  externalRef?: string;
}
/** what the CRM holds for a customer, as this app reads it back */
export interface CrmCustomer extends NewCustomer {
  customerId: string;
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
}

/** the CRM's doors this client knocks on (ppwk-crm payments, REQ-057/076/077 there) */
const CUSTOMERS = "/api/payments/customers";
const DUES = "/api/payments/dues";
const PAY_LINKS = "/api/payments/pay-links";
const CATEGORY = "sales";

class PaymentsUnavailableError extends Error {
  readonly status = 502;
  constructor(detail: string) {
    super(`payments-unavailable: ${detail}`);
    this.name = "PaymentsUnavailableError";
  }
}

/** the real one: ppwk-crm's payments API behind the operator token */
class CrmPaymentsLink implements PaymentsLinkPort {
  constructor(private readonly origin: string, private readonly token: string, private readonly f: typeof fetch = globalThis.fetch) {}

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    try {
      return await this.f(`${this.origin}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new PaymentsUnavailableError(`${method} ${path}: ${String(e)}`);
    }
  }
  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.send(method, path, body);
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
    return { customerId: c.customerId, customerName: c.customerName, customerEmail: c.customerEmail, customerPhone: c.customerPhone, externalRef: c.externalRef };
  }
  async raiseDue(input: NewDue) {
    const d = await this.call<{ dueId: string }>("POST", DUES, { ...input, categoryCode: CATEGORY });
    return { dueId: d.dueId };
  }
  async mintPayLink(input: NewPayLink) {
    const l = await this.call<{ chargeUrl: string }>("POST", PAY_LINKS, { ...input, brandId: "" });
    return { payUrl: `${this.origin}${l.chargeUrl}` };
  }
  async dueOpen(dueId: string) {
    const d = await this.call<{ open: boolean }>("GET", `${DUES}/${encodeURIComponent(dueId)}`);
    return d.open === true;
  }
}

/** the fake's world — what a story or an int test reads back and settles */
class FakePaymentsWorld {
  customers: CrmCustomer[] = [];
  dues: Array<NewDue & { dueId: string; open: boolean }> = [];
  links: Array<NewPayLink & { payUrl: string }> = [];
  reset() {
    this.customers = [];
    this.dues = [];
    this.links = [];
  }
  /** the card landed: what the real pay page does to the due */
  settle(dueId: string) {
    const due = this.dues.find((d) => d.dueId === dueId);
    if (!due) throw Object.assign(new Error(`due-missing: ${dueId}`), { status: 404 });
    due.open = false;
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
      Object.assign(known, { ...input, customerId: known.customerId });
      return Promise.resolve({ customerId: known.customerId });
    }
    const customerId = crypto.randomUUID();
    this.world.customers.push({ ...input, customerId });
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
    const payUrl = `${fakePayPageOrigin()}/pay/fake?${q}`;
    this.world.links.push({ ...input, payUrl });
    return Promise.resolve({ payUrl });
  }
  dueOpen(dueId: string) {
    const due = this.world.dues.find((d) => d.dueId === dueId);
    return Promise.resolve(due ? due.open : false);
  }
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

  constructor() {
    this.which();
  }
  private which(): PaymentsLinkName {
    return selectPaymentsLinkName({
      PPWK_PAYMENTS_URL: Deno.env.get("PPWK_PAYMENTS_URL"),
      PPWK_PAYMENTS_TOKEN: Deno.env.get("PPWK_PAYMENTS_TOKEN"),
      DENO_DEPLOYMENT_ID: Deno.env.get("DENO_DEPLOYMENT_ID"),
    });
  }
  isFake(): boolean {
    return this.which() === "fake";
  }
  private port(): PaymentsLinkPort {
    if (this.which() === "fake") return new FakePaymentsLink();
    const origin = (Deno.env.get("PPWK_PAYMENTS_URL") ?? "").trim().replace(/\/+$/, "");
    const token = (Deno.env.get("PPWK_PAYMENTS_TOKEN") ?? "").trim();
    return new CrmPaymentsLink(origin, token, this.fetchOverride ?? globalThis.fetch);
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
}
