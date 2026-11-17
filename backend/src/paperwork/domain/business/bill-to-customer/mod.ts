/**
 * REQ-696 (demo-loop cycle 5, issues M5 + M22) — the customer an invoice's
 * typed BILL TO name stands for.
 *
 * REQ-550 lets an invoice be issued with no customer, only a bill-to name
 * (Nueva factura's "Sin cliente (agregar después)"). Every reader keys money
 * on the customerId — the customers page, its owed total, the invoice list,
 * the forecast — so that invoice belonged to nobody: "$0 que te deben" while
 * Jorge owed $200, "—" as the client. The bill-to name IS the customer: the
 * same customer when the account has one (REQ-331's shared rule — phone,
 * email, then the whole name, accent- and case-blind), else a new one with
 * the bill-to's well-formed contact (REQ-278; a malformed one is left off,
 * never a failed issue).
 *
 * Pure: the plan only; the controller attaches or creates.
 */
import {
  type DedupableCustomer,
  findExistingCustomer,
} from "#quote-flow/customer-dedupe.ts";
import {
  isValidCustomerEmail,
  isValidCustomerPhone,
} from "#quote-flow/customer-contact.ts";
import type { CustomerSnapshot } from "@core/data/numbered-store/mod.ts";
import type { CreateCustomerDto } from "@crm/dto/customer.ts";

export type BillToCustomerPlan =
  | { attach: string }
  | { create: CreateCustomerDto };

const clean = (s: string | null | undefined): string => (s ?? "").trim();

export function billToCustomerPlan(
  billTo: CustomerSnapshot | undefined,
  customers: readonly DedupableCustomer[],
): BillToCustomerPlan | undefined {
  const name = clean(billTo?.name);
  if (!name) return undefined;
  const email = clean(billTo?.email);
  const phoneNumber = clean(billTo?.phoneNumber);
  const hit = findExistingCustomer([...customers], {
    name,
    email,
    phoneNumber,
  });
  if (hit) return { attach: hit.id };
  const businessName = clean(billTo?.businessName);
  const address = clean(billTo?.address);
  return {
    create: {
      name,
      ...(email && isValidCustomerEmail(email) ? { email } : {}),
      ...(phoneNumber && isValidCustomerPhone(phoneNumber)
        ? { phoneNumber }
        : {}),
      ...(address ? { address } : {}),
      ...(businessName ? { businessName } : {}),
    },
  };
}
