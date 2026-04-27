import type { Customer } from "@crm/dto/customer.ts";

export function formatDisplayName(customer: Pick<Customer, "name" | "email">): string {
  return customer.email ? `${customer.name} <${customer.email}>` : customer.name;
}
