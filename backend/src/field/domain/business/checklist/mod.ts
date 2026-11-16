/**
 * REQ-811 — a checklist: a named list of services (task types with a price) a repeat
 * visit REFERENCES instead of listing the same items again. The visit's effective
 * services are the checklist's followed by its own; a type in both takes the visit's
 * own price (the per-customer override). Pure: the stores hand in the records.
 */
import type {
  Checklist,
  Subscription,
  SubscriptionItem,
} from "@field/dto/field.ts";
import { fold } from "@field/domain/business/tasks/mod.ts";

/** the services a visit bills: the checklist's items, then the visit's own extras; an own row on the same type wins */
export function effectiveItems(
  s: Pick<Subscription, "items"> & { checklistId?: string },
  checklist: Checklist | null | undefined,
): SubscriptionItem[] {
  if (!s.checklistId || !checklist || checklist.id !== s.checklistId) {
    return s.items;
  }
  const own = new Map(s.items.map((i) => [i.taskTypeId, i]));
  const out: SubscriptionItem[] = [];
  for (const c of checklist.items) {
    if (out.some((o) => o.taskTypeId === c.taskTypeId)) continue;
    out.push(own.get(c.taskTypeId) ?? c);
  }
  for (const o of s.items) {
    if (!out.some((x) => x.taskTypeId === o.taskTypeId)) out.push(o);
  }
  return out;
}

/** the same record with its effective items — or the record itself when it has no (known) checklist */
export function withChecklist<S extends Subscription>(
  s: S,
  find: (id: string) => Checklist | null | undefined,
): S {
  if (!s.checklistId) return s;
  const c = find(s.checklistId);
  if (!c) return s;
  return { ...s, items: effectiveItems(s, c) };
}

/** a visit needs a checklist or at least one row of its own */
export const hasServices = (
  items: SubscriptionItem[],
  checklistId: string | undefined,
) => items.length > 0 || !!checklistId;

/** REQ-811: the name is unique in the account, in any case or accent; the record itself is not a clash */
export function checklistNameTaken(
  all: Checklist[],
  name: string,
  exceptId?: string,
): boolean {
  const key = fold(name);
  return all.some((c) => c.id !== exceptId && fold(c.name) === key);
}

/** how many repeat visits reference the checklist */
export const checklistUsage = (
  subs: Pick<Subscription, "checklistId">[],
  checklistId: string,
) => subs.filter((s) => s.checklistId === checklistId).length;
