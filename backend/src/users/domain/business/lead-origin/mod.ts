/**
 * REQ-211 — the lead origin (the landing page a form was on, the ad that brought the person), as
 * the backend reads it. The one implementation lives in shared/lead-origin (the browser attaches
 * it from there); this module is the backend's door to it.
 */
export {
  type LeadOrigin,
  leadOriginHere,
  leadOriginLabel,
  leadOriginOf,
  leadSourceFor,
} from "#lead-origin/mod.ts";
