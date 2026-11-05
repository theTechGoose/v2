/**
 * REQ-177 — the per-account feature registry. A super admin switches a feature on or off for
 * one account on /admin → Accounts; the code that implements a feature asks `featureOn`.
 * Shared by the backend (`#features`) and the front end (relative import).
 */
export const FEATURES = [
  {
    key: "fieldTexts",
    label: "Field texts",
    hint:
      "Texts a worker about a new job for today, and texts customers: on the schedule at 9 am, a canceled service, a moved service.",
  },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export type Features = Partial<Record<FeatureKey, boolean>>;

export function isFeatureKey(k: unknown): k is FeatureKey {
  return typeof k === "string" && FEATURES.some((f) => f.key === k);
}

/** on only when the account says so — unset is off */
export function featureOn(
  features: Features | undefined,
  key: FeatureKey,
): boolean {
  return features?.[key] === true;
}
