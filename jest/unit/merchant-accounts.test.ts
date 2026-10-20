/**
 * REQ-101 — "PRIMARY IS THE ACUTAL ACCOUNT AND SANDBOX IS THE FAKE ACCOUNT BUT WE CAN ADD MORE."
 * REQ-100 — "THERE NEEDS TO BE A SINGLE SOURCE OF TRUTH WHEN IT REGARDS TO WHAT ACCOUNT IS BEING USED."
 *
 * The one module that names the merchant accounts and the one rule that picks the account a
 * charge goes through: a plan pick is `primary`; the hidden $1 test tier is `sandbox` unless its
 * address names another; a name on the pick always wins. The list is open — any slug the CRM has
 * on record is a valid name here; the CRM refuses the rest.
 */
import { accountForPick, KNOWN_ACCOUNTS, PRIMARY_ACCOUNT, SANDBOX_ACCOUNT } from "../../shared/quote-flow/merchant-accounts";

describe("REQ-101 merchant accounts", () => {
  test("REQ-101 primary is the real account and sandbox the fake one; both are on the list", () => {
    expect(PRIMARY_ACCOUNT).toBe("primary");
    expect(SANDBOX_ACCOUNT).toBe("sandbox");
    expect([...KNOWN_ACCOUNTS]).toEqual(["primary", "sandbox"]);
  });

  test("REQ-100 a plan pick that names nothing goes through primary — never an env var, never a default elsewhere", () => {
    expect(accountForPick("monster", "")).toBe("primary");
    expect(accountForPick("assist", "")).toBe("primary");
  });

  test("REQ-101 the $1 test tier goes through sandbox unless its address names another account", () => {
    expect(accountForPick("test", "")).toBe("sandbox");
    expect(accountForPick("test", "primary")).toBe("primary");
  });

  test("REQ-101 a name on the pick wins for any plan — more accounts can be added on the CRM", () => {
    expect(accountForPick("monster", "alpha")).toBe("alpha");
    expect(accountForPick("test", "alpha")).toBe("alpha");
  });
});
