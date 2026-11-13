/**
 * REQ-373 — the words on the customer's demo pill (demo-loop cycle 2, m2 + p13-h). The compact
 * pill names the guide by first name ("● Alex · Connected · End"); the sentence "{name} is
 * guiding you" is not repeated by a chip when there is one presenter; the details button is
 * labelled by the status alone ("Connected, show details"), so a screen reader hears the name
 * once.
 */

export type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

/** the first word of a presenter's name ("Alex from DocuMonster" → "Alex") */
export function guideFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

export interface PillCopy {
  /** the first name(s) the compact pill draws next to its dot */
  shortName: string;
  /** the short name is drawn: the details are hidden (compact and closed) */
  showShort: boolean;
  /** chips next to the sentence only when there are several presenters */
  showChips: boolean;
  /** the details button's accessible name: the status, never the guiding sentence */
  moreLabel: string;
}

export function pillCopy(o: {
  presenters: readonly { name: string }[];
  status: string;
  compact: boolean;
  open: boolean;
  t: Translate;
}): PillCopy {
  const showShort = o.compact && !o.open;
  return {
    shortName: o.presenters.map((p) => guideFirstName(p.name)).filter(Boolean)
      .join(", "),
    showShort,
    showChips: o.presenters.length > 1,
    moreLabel: !o.compact ? o.status : o.t(
      o.open ? "demoMode.statusHideDetails" : "demoMode.statusShowDetails",
      { status: o.status },
    ),
  };
}
