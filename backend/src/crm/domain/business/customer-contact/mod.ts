import type { Customer } from "@crm/dto/customer.ts";

export type ContactChannel = "email" | "phone" | "mail" | "none";

export function primaryChannel(
  c: Pick<Customer, "email" | "phoneNumber" | "address">,
): ContactChannel {
  if (c.email) return "email";
  if (c.phoneNumber) return "phone";
  if (c.address) return "mail";
  return "none";
}
