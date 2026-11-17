/**
 * REQ-662 (demo-loop cycle 5, m19 — pair 10): what a load does with a Job
 * Details picker restored from the stored draft. A draft saved while the
 * options were still being written comes back with the picker open and no
 * options — and the picker used to paint "Writing up your options…" with
 * nothing in flight. The loader now shows only while a request runs, so a
 * picker without options asks for them again (or closes when there is
 * nothing to write them from).
 */
export type RestoredPickerAction =
  | "none"
  | "refetch_polish"
  | "refetch_confirm"
  | "close";

export function restoredPickerAction(d: {
  jobOptionsOpen: boolean;
  pickerMode: "polish" | "confirm";
  jobOptions: readonly unknown[] | null;
  jobDetailsRaw: string | null;
  submittedJobDetails: string | null;
}): RestoredPickerAction {
  if (!d.jobOptionsOpen || d.jobOptions) return "none";
  // The end-of-wizard picker always settles: the quote's own details, the
  // phase-1 text, or the honest fallback cards (settleJobOptions).
  if (d.pickerMode === "polish") return "refetch_polish";
  const raw = d.jobDetailsRaw ?? d.submittedJobDetails ?? "";
  return raw.trim() ? "refetch_confirm" : "close";
}
