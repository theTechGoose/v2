import type { Installment } from "@paperwork/dto/payment-terms.ts";

export interface ResolvedInstallment {
  percent: number;
  dueDate: string;
  amount: number;
  label?: string;
  note?: string;
}

export function totalPercent(installments: Pick<Installment, "percent">[]): number {
  return installments.reduce((sum, i) => sum + i.percent, 0);
}

export function isBalanced(installments: Pick<Installment, "percent">[]): boolean {
  return Math.abs(totalPercent(installments) - 100) < 0.001;
}

export function applyTo(installments: Installment[], total: number): ResolvedInstallment[] {
  // Audit1 #3 — `total` and the resulting `amount` are both INTEGER CENTS.
  // The formula stays a simple percentage application (percent of total),
  // but we round AFTER the divide so the result is always whole cents.
  return installments.map((i) => ({
    ...i,
    amount: Math.round((i.percent * total) / 100),
  }));
}

export function nextDue<T extends Pick<Installment, "dueDate">>(
  installments: T[],
  now: Date,
): T | null {
  const future = installments
    .filter((i) => new Date(i.dueDate).getTime() >= now.getTime())
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return future[0] ?? null;
}

export function pastDue<T extends Pick<Installment, "dueDate">>(
  installments: T[],
  now: Date,
): T[] {
  return installments
    .filter((i) => new Date(i.dueDate).getTime() < now.getTime())
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
