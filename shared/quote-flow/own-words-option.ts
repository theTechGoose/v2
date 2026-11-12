/**
 * REQ-381 (demo M20) — the "use what I wrote" option on the help-me-price
 * confirm step. The green strip echoes the message the contractor typed;
 * clicking it confirms THAT message (not the pre-selected generated card),
 * run through the shared scope pass (`scopeBulletsFromRaw`: intent opener,
 * price clause and pricing question stripped, one bullet per line). When no
 * scope line survives the pass, the typed lines are kept as written — the
 * contractor explicitly chose their own words. Pure.
 */
import { scopeBulletsFromRaw, type ScopeLang } from "./scope-from-raw.ts";

export interface OwnWordsOption {
  jobName: string;
  summary: string;
  bullets: string[];
}

export function ownWordsOption(
  raw: string,
  lang: ScopeLang,
): OwnWordsOption | null {
  const typed = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (typed.length === 0) return null;
  const scoped = scopeBulletsFromRaw(raw, lang);
  const bullets = scoped.degraded ? typed : scoped.bullets;
  const summary = bullets[0];
  // Job Names are ≤3 words platform-wide (roadmap p.10).
  const jobName = summary.split(/\s+/).slice(0, 3).join(" ");
  return { jobName, summary, bullets };
}
