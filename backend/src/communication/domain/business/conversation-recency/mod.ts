export function isStale(
  c: { updatedAt?: string },
  now: Date,
  staleAfterDays: number,
): boolean {
  if (!c.updatedAt) return true;
  const updated = new Date(c.updatedAt).getTime();
  if (Number.isNaN(updated)) return true;
  const ageDays = (now.getTime() - updated) / (1000 * 60 * 60 * 24);
  return ageDays >= staleAfterDays;
}
