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
  return threadName(parts) ?? part(parts.title) ??
    NEW_CONVERSATION[lang];
}

/**
 * REQ-385 (demo-loop cycle 2, m6): the thread's name from its job and its
 * customer — the job name, then "· customer" appended — or undefined when it
 * has neither. The chat header (`deriveChatHeader`) and the list
 * (`threadTitle`) both name a thread through this, so the title only ever
 * grows; it never swaps the job for the customer.
 */
export function threadName(
  parts: Pick<ThreadTitleParts, "jobName" | "customerName">,
): string | undefined {
  const job = part(parts.jobName);
  const customer = part(parts.customerName);
  if (job && customer) return `${job} · ${customer}`;
  return job ?? customer;
}
