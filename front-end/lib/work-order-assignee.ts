/**
 * REQ-1022 (LOOP-007 q2-12) — a work order's Assignee as the office sees it. The assignee marked
 * out on its day (REQ-842) is shown with who covers ("Jake Fowler → covered by Miguel Torres"), or
 * flagged out when their work is deferred / skipped / the cover is out too — the WO still needs
 * rescheduling. Nothing about the absence → the assignee as stored.
 */
export interface AssigneeCover {
  assignee?: string;
  coverAssignee?: string;
  assigneeOut?: "defer" | "skip" | "uncovered";
}

type T = (key: string, params?: Record<string, string>) => string;

export function assigneeLabel(wo: AssigneeCover, t: T): string | undefined {
  const name = wo.assignee?.trim() || "—";
  if (wo.coverAssignee) {
    return t("workOrders.assignee.coveredBy", {
      name,
      cover: wo.coverAssignee,
    });
  }
  if (wo.assigneeOut) return t("workOrders.assignee.out", { name });
  return wo.assignee || undefined;
}
