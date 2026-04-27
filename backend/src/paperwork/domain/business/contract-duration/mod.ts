import type { Contract } from "@paperwork/dto/contract.ts";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function durationDays(
  c: Pick<Contract, "startDate" | "estimatedCompletionDate">,
): number | null {
  if (!c.startDate || !c.estimatedCompletionDate) return null;
  const start = new Date(c.startDate).getTime();
  const end = new Date(c.estimatedCompletionDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / MS_PER_DAY));
}
