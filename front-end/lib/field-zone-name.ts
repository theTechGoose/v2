/**
 * REQ-994 (LOOP-007 q1-83) — the one place a zone's display name is made.
 *
 * The server stores auto-generated zone names in Spanish (REQ-140 regionName()
 * → "Zona A", "Zona B"…). An English account reads "Zone A". Every screen that
 * prints a zone — /field/subscriptions, /field/assignments, /field/tasks,
 * /field/workers and the worker-error text — goes through this helper, so the
 * same zone never carries two names.
 */
export function zoneName(name: string, lang: "en" | "es"): string {
  return lang === "en" ? name.replace(/^Zona /, "Zone ") : name;
}
