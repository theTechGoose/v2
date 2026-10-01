// REQ-054 — the CRM's link builder, from this app's side: a customer, the first month as a due,
// the pay link that collects it, and whether the due still reads open. Real against ppwk-crm's
// payments API when PPWK_PAYMENTS_URL + PPWK_PAYMENTS_TOKEN are set; otherwise the in-process
// fake the gate's lanes run on (the same way EmailService runs without a Postmark key).
import { Injectable } from "#danet/core";

export interface NewCustomer {
  customerName: string;
  customerEmail: string;
}
export interface NewDue {
  customerId: string;
  amountCents: number;
  memo: string;
}
export interface PaymentsLinkPort {
  createCustomer(input: NewCustomer): Promise<{ customerId: string }>;
  raiseDue(input: NewDue): Promise<{ dueId: string }>;
  mintPayLink(input: { customerId: string; dueId: string }): Promise<{ payUrl: string }>;
  /** does the CRM's ledger still say something is outstanding on this due */
  dueOpen(dueId: string): Promise<boolean>;
}

/** the CRM's doors this client knocks on (ppwk-crm payments, REQ-057 there) */
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

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.f(`${this.origin}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new PaymentsUnavailableError(`${method} ${path}: ${String(e)}`);
    }
    const text = await res.text();
    if (!res.ok) throw new PaymentsUnavailableError(`${method} ${path} answered ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  }

  async createCustomer(input: NewCustomer) {
    const c = await this.call<{ customerId: string }>("POST", CUSTOMERS, input);
    return { customerId: c.customerId };
  }
  async raiseDue(input: NewDue) {
    const d = await this.call<{ dueId: string }>("POST", DUES, { ...input, categoryCode: CATEGORY });
    return { dueId: d.dueId };
  }
  async mintPayLink(input: { customerId: string; dueId: string }) {
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
  customers: Array<NewCustomer & { customerId: string }> = [];
  dues: Array<NewDue & { dueId: string; open: boolean }> = [];
  links: Array<{ customerId: string; dueId: string; payUrl: string }> = [];
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

class FakePaymentsLink implements PaymentsLinkPort {
  constructor(private readonly world = WORLD) {}
  createCustomer(input: NewCustomer) {
    const customerId = crypto.randomUUID();
    this.world.customers.push({ ...input, customerId });
    return Promise.resolve({ customerId });
  }
  raiseDue(input: NewDue) {
    const dueId = crypto.randomUUID();
    this.world.dues.push({ ...input, dueId, open: true });
    return Promise.resolve({ dueId });
  }
  mintPayLink(input: { customerId: string; dueId: string }) {
    // the shape the real link builder makes: the charge page carrying the customer's ref
    const payUrl = `https://payments.fake/ui/payments/charge?customer=${input.customerId}&due=${input.dueId}`;
    this.world.links.push({ ...input, payUrl });
    return Promise.resolve({ payUrl });
  }
  dueOpen(dueId: string) {
    const due = this.world.dues.find((d) => d.dueId === dueId);
    return Promise.resolve(due ? due.open : false);
  }
}

/** real when both env keys are set, the fake otherwise — decided per call, so a test can flip it */
@Injectable()
export class PaymentsLink implements PaymentsLinkPort {
  /** test seam for the real client's HTTP, like EmailService.fetchOverride */
  fetchOverride: typeof fetch | null = null;

  isFake(): boolean {
    return !(Deno.env.get("PPWK_PAYMENTS_URL") && Deno.env.get("PPWK_PAYMENTS_TOKEN"));
  }
  private port(): PaymentsLinkPort {
    const origin = (Deno.env.get("PPWK_PAYMENTS_URL") ?? "").replace(/\/+$/, "");
    const token = Deno.env.get("PPWK_PAYMENTS_TOKEN") ?? "";
    if (!origin || !token) return new FakePaymentsLink();
    return new CrmPaymentsLink(origin, token, this.fetchOverride ?? globalThis.fetch);
  }
  createCustomer(input: NewCustomer) {
    return this.port().createCustomer(input);
  }
  raiseDue(input: NewDue) {
    return this.port().raiseDue(input);
  }
  mintPayLink(input: { customerId: string; dueId: string }) {
    return this.port().mintPayLink(input);
  }
  dueOpen(dueId: string) {
    return this.port().dueOpen(dueId);
  }
}
