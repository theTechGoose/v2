/**
 * REQ-659 (demo-loop cycle 5, m53) — the term grid an INVOICE shows.
 *
 * The invoice mirrors the agreement's wizard terms (start / time to complete
 * / payment / warranty). The start is stored the way the contractor picked it
 * when quoting — "Next week", "Right away", "TBD" — so it is relative to the
 * day the quote went out. A finished job's bill, issued weeks later, still
 * said "Fecha de inicio: La próxima semana". The relative start is dropped
 * once the bill is issued on or after the day it pointed to (a TBD start once
 * issued after the quote's day); a deposit bill issued with the quote keeps
 * it, and a concrete start date ("2026-10-15") always stays. Pure.
 */
import { startFromTerm } from "./completion-schedule.ts";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const US_DAY = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const TBD =
  /^(?:tbd|to be (?:determined|decided|scheduled)|por (?:definir|determinar|agendar))$/;

const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

/** The UTC day of an ISO date or timestamp; undefined when unparseable. */
function dayOf(at: string | undefined): Date | undefined {
  if (!at) return undefined;
  const d = new Date(ISO_DAY.test(at) ? `${at}T00:00:00Z` : at);
  if (!Number.isFinite(d.getTime())) return undefined;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** True when the start term was outlived by a bill issued on `issued`. */
function staleStart(value: string, quoted: Date, issued: Date): boolean {
  const v = fold(value);
  if (!v || ISO_DAY.test(v) || US_DAY.test(v)) return false;
  if (TBD.test(v)) return issued.getTime() > quoted.getTime();
  const start = startFromTerm(value, quoted);
  return !!start && issued.getTime() >= start.getTime();
}

export function invoiceTerms<T extends { stepId: string; value: string }>(
  terms: readonly T[] | null | undefined,
  at: { quotedAt?: string; issuedAt?: string },
): T[] {
  // REQ-771: the job is done — the quote's deadline row is not billed.
  // REQ-783: nor is the agreement's cancellation notice.
  const list = (terms ?? []).filter((t) =>
    t.stepId !== "deadline" && t.stepId !== "cancellation"
  );
  const quoted = dayOf(at.quotedAt);
  const issued = dayOf(at.issuedAt) ?? dayOf(new Date().toISOString());
  if (!quoted || !issued) return list;
  return list.filter((t) =>
    !(t.stepId === "start_date" && staleStart(t.value, quoted, issued))
  );
}
