/**
 * US state reference data for the client (the /welcome wizard's state step).
 * REQ-992: the table now lives in shared/customer-address/us-states.ts so the
 * customer address rule (front end and backend) reads the same list.
 */
export {
  stateName,
  US_STATE_OPTIONS,
  US_STATES,
} from "../../shared/customer-address/us-states.ts";
