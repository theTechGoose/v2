import type { Contract } from "@paperwork/dto/contract.ts";
import { isSigned } from "@paperwork/domain/business/contract-status/mod.ts";

export const CONTRACT_MOODS = [
  "draft",
  "starting-soon",
  "active",
  "wrapping-up",
  "completed",
  "stale",
] as const;
export type ContractMood = typeof CONTRACT_MOODS[number];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Signed contracts whose startDate is within this window project as "starting-soon". */
const STARTING_SOON_DAYS = 7;
/** Active contracts whose estimatedCompletionDate is within this window project as "wrapping-up". */
const WRAPPING_UP_DAYS = 7;
/** Drafts that haven't been touched in this many days project as "stale". */
const STALE_DRAFT_DAYS = 30;

/**
 * deriveMood — projects a Contract into a UI-facing urgency / lifecycle mood.
 *
 *   draft         → unsigned (no signedAt, status !== "signed")
 *   stale         → unsigned + last touched > 30 days ago
 *   starting-soon → signed + startDate within 7 days
 *   active        → signed, started, but not in any narrower bucket
 *   wrapping-up   → signed + estimatedCompletionDate within 7 days (and still in the future)
 *   completed     → signed + estimatedCompletionDate is in the past
 */
export function deriveMood(
  contract: Pick<Contract, "signedAt" | "status" | "startDate" | "estimatedCompletionDate" | "updatedAt">,
  now: Date,
): ContractMood {
  if (!isSigned(contract)) {
    if (contract.updatedAt) {
      const idleDays = (now.getTime() - new Date(contract.updatedAt).getTime()) / MS_PER_DAY;
      if (idleDays > STALE_DRAFT_DAYS) return "stale";
    }
    return "draft";
  }

  if (contract.estimatedCompletionDate) {
    const completionMs = new Date(contract.estimatedCompletionDate).getTime();
    const daysUntilCompletion = (completionMs - now.getTime()) / MS_PER_DAY;
    if (daysUntilCompletion < 0) return "completed";
    if (daysUntilCompletion <= WRAPPING_UP_DAYS) return "wrapping-up";
  }

  if (contract.startDate) {
    const startMs = new Date(contract.startDate).getTime();
    const daysUntilStart = (startMs - now.getTime()) / MS_PER_DAY;
    if (daysUntilStart > 0 && daysUntilStart <= STARTING_SOON_DAYS) return "starting-soon";
  }

  return "active";
}
