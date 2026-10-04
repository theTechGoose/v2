import { assert, assertEquals } from "#std/assert";
import { PaymentsLink } from "./mod.ts";

// REQ-054 smoke — the REAL client against a running ppwk-crm (an external service: never in the
// gate, on demand through `deno task test:smoke`). Ignored unless both keys point at one:
//   PPWK_PAYMENTS_URL=http://localhost:9162 PPWK_PAYMENTS_TOKEN=<its PAYMENTS_OPERATOR_TOKEN> deno task test:smoke
const ORIGIN = Deno.env.get("PPWK_PAYMENTS_URL") ?? "";
const TOKEN = Deno.env.get("PPWK_PAYMENTS_TOKEN") ?? "";

Deno.test({
  name: "REQ-054 smoke: the real link builder — a customer, the first month as a due, a pay link on the CRM's charge page, and the due reads open until it is paid",
  ignore: !(ORIGIN && TOKEN),
  async fn() {
    const link = new PaymentsLink();
    assertEquals(link.isFake(), false, "both keys set → the real client");
    const stamp = Date.now();
    const { customerId } = await link.createCustomer({ customerName: `Smoke ${stamp}`, customerEmail: `smoke-${stamp}@blackhole.postmarkapp.com` });
    assert(customerId, "the CRM answered a customerId");
    const { dueId } = await link.raiseDue({ customerId, amountCents: 9900, memo: "Monster — first month (smoke)" });
    assert(dueId, "the CRM answered a dueId");
    const { payUrl } = await link.mintPayLink({ customerId, dueId });
    const u = new URL(payUrl);
    assertEquals(u.origin, new URL(ORIGIN).origin, "the pay link lives on the CRM");
    assertEquals(u.pathname, "/ui/payments/charge", "the pay link is the charge page");
    assert(u.searchParams.get("customer"), "the link carries the server-signed customer ref");
    assertEquals(u.searchParams.get("due"), dueId, "the link names the due it collects");
    assertEquals(await link.dueOpen(dueId), true, "nothing paid yet: the due is open");
    const page = await fetch(payUrl);
    await page.body?.cancel();
    assertEquals(page.status, 200, "the pay page answers");
  },
});
