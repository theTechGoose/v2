/**
 * REQ-100 — "THERE NEEDS TO BE A SINGLE SOURCE OF TRUTH WHEN IT REGARDS TO WHAT ACCOUNT IS BEING
 * USED." (Raphael, 2026-10-20)
 * REQ-101 — "PRIMARY IS THE ACUTAL ACCOUNT AND SANDBOX IS THE FAKE ACCOUNT BUT WE CAN ADD MORE."
 *
 * The one module that names the merchant accounts and the one rule that decides which account a
 * charge goes through. Both apps read it: the backend puts the name on the CRM's `x-account`
 * header, on the pay link and on the plan's record; the front-end shows it on the test page. No
 * env var has a say any more — `PPWK_PAYMENTS_ACCOUNT=sandbox` on Deploy is what sent a real
 * customer's $99 (NMI 12670394611, 2026-10-12) through the test account while every page said
 * nothing. The accounts themselves are defined on the CRM's Accounts tab (ppwk-crm REQ-091,
 * /ui/payments/admin?tab=accounts): the name here must be a name on record there; the CRM refuses
 * any other (`merchant-unknown`), and so does this app's fake.
 */

/** the real account: a real card, real money, settles at the gateway */
export const PRIMARY_ACCOUNT = "primary";
/** the fake account: test cards, nothing settles */
export const SANDBOX_ACCOUNT = "sandbox";
/** the accounts on record by default; the operator can add more on the CRM */
export const KNOWN_ACCOUNTS: readonly string[] = [PRIMARY_ACCOUNT, SANDBOX_ACCOUNT];

/** the hidden $1 test tier (REQ-064): the one plan that is a test charge by nature */
const TEST_PLAN_ID = "test";

/**
 * the account a pick goes through: the one it names when it names one (`/plan/test?merchant=`),
 * else sandbox for the $1 test tier and primary for every real plan
 */
export function accountForPick(planId: string, named: string): string {
  const name = named.trim();
  if (name) return name;
  return planId === TEST_PLAN_ID ? SANDBOX_ACCOUNT : PRIMARY_ACCOUNT;
}
