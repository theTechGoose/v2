/**
 * Minimal HTTP client for integration tests against the dev stack.
 *
 * Uses the frontend proxy (:5280/api/* → backend :4280) exactly like the
 * Cypress harness, and the dev master OTP (000000) for auth. Cookie jar is
 * per-session so tests can hold both a contractor and a "customer"
 * (anonymous) context at once.
 *
 * Base URL override: API_BASE_URL (default http://localhost:5280/api).
 */
const BASE = process.env.API_BASE_URL ?? "http://localhost:5280/api";

export class ApiSession {
  private cookies = new Map<string, string>();

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private storeCookies(res: Response) {
    const any = res.headers as unknown as { getSetCookie?: () => string[] };
    const set = any.getSetCookie?.() ??
      (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
    for (const line of set) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  async req(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: any; res: Response }> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    this.storeCookies(res);
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON (HTML page etc.) — return raw text */
    }
    return { status: res.status, body: parsed, res };
  }

  get(path: string) {
    return this.req("GET", path);
  }
  post(path: string, body?: unknown) {
    return this.req("POST", path, body);
  }
  put(path: string, body?: unknown) {
    return this.req("PUT", path, body);
  }
  del(path: string) {
    return this.req("DELETE", path);
  }

  /** Dev master-OTP login; seeds name + business identity like cy.loginAs. */
  async loginAs(phoneNumber: string) {
    const v = await this.post("/auth/verify", { phoneNumber, code: "000000" });
    if (v.status >= 400) {
      throw new Error(`loginAs(${phoneNumber}) failed: ${v.status} ${JSON.stringify(v.body)}`);
    }
    const me = await this.get("/me");
    if (!me.body?.name) await this.put("/me", { name: "Jest Contractor" });
    const id = await this.get("/profile/identity");
    if (!id.body?.businessName) {
      await this.put("/profile/identity", { businessName: "JEST LLC" });
    }
    return this;
  }
}

/** Fresh authed contractor session. */
export async function contractor(phone = "+15125550901"): Promise<ApiSession> {
  return await new ApiSession().loginAs(phone);
}

/** Anonymous session (customer clicking public links). */
export function anonymous(): ApiSession {
  return new ApiSession();
}

/** Create a customer (quotes/invoices link customers by id, never inline). */
export async function seedCustomer(
  s: ApiSession,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const r = await s.post("/customers", {
    name: "Green Goblin",
    email: "green.jest@example.com",
    phone: "+15125550902",
    ...overrides,
  });
  if (r.status >= 400 || !r.body?.id) {
    throw new Error(`seedCustomer failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body.id as string;
}

/** Seed a minimal quote (customer-first, per CreateQuoteDto); returns its id. */
export async function seedQuote(
  s: ApiSession,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const customerId = (overrides.customerId as string) ?? await seedCustomer(s);
  const r = await s.post("/quotes", {
    summary: "Removing junk from a backyard",
    jobName: "Backyard Junk Removal",
    description: "Removing junk from a backyard and making sure no trash remains",
    lineItems: [
      { description: "Junk removal", quantity: 1, unit: "job", price: 55000 },
    ],
    estimatedTotal: 55000,
    ...overrides,
    customerId,
  });
  if (r.status >= 400 || !r.body?.id) {
    throw new Error(`seedQuote failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body.id as string;
}

/** Seed an invoice (amount is the app's INTEGER-CENTS field); returns its id. */
export async function seedInvoice(
  s: ApiSession,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const customerId = (overrides.customerId as string) ?? await seedCustomer(s);
  const r = await s.post("/invoices", {
    jobName: "Backyard Junk Removal",
    lineItems: [
      { description: "Junk removal", quantity: 1, unit: "job", price: 55000 },
    ],
    amount: 55000,
    dueDate: "2026-09-30",
    ...overrides,
    customerId,
  });
  if (r.status >= 400 || !r.body?.id) {
    throw new Error(`seedInvoice failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  return r.body.id as string;
}
