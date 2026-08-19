/**
 * Thread title (UX-14) — the assistant thread list names each conversation
 * by what it is about: "«jobName» · «customerName»", never a wall of
 * "Nueva conversación" rows.
 *
 * Pure logic, no side effects. The fallback strings mirror the dictionaries'
 * asstThreads.newConversation (lang/en.json / lang/es.json) — keep in sync.
 */

export interface ThreadTitleParts {
  jobName?: string | null;
  customerName?: string | null;
  title?: string | null;
}

const NEW_CONVERSATION: Record<"en" | "es", string> = {
  en: "New conversation",
  es: "Nueva conversación",
};

function part(value: string | null | undefined): string | undefined {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : undefined;
}

/**
 *   job + customer → "«jobName» · «customerName»"
 *   customer only  → customerName; job only → jobName
 *   neither        → title when present, else the localized fallback.
 */
export function threadTitle(
  parts: ThreadTitleParts,
  lang: "en" | "es",
): string {
  const job = part(parts.jobName);
  const customer = part(parts.customerName);
  if (job && customer) return `${job} · ${customer}`;
  if (customer) return customer;
  if (job) return job;
  return part(parts.title) ?? NEW_CONVERSATION[lang];
}
