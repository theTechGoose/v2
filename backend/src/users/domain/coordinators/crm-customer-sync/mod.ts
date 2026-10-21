// REQ-058 — "when someone signs up it should build them as a customer then add their info when
// they finish the onboarding". The account IS a CRM customer from its first sign-in: made then
// with what there is (the phone), revised by every later write — the name and email from
// settings or the wizard, the business name from the identity — always the ONE record that
// carries this account's ref (externalRefFor; the CRM upserts by it, ppwk-crm REQ-076). The
// paid pick (ChoosePlan) reuses that customer, so the pay page and the receipt name the person.
import { Injectable } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@users/domain/data/business-address-store/mod.ts";
import { BusinessInsuranceStore } from "@users/domain/data/business-insurance-store/mod.ts";
import type { BusinessAddress } from "@users/dto/business-address.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import type { BusinessInsurance } from "@users/dto/business-insurance.ts";
import { signupProgress } from "@users/domain/business/signup-progress/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { type CrmCustomer, type NewCustomer, PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { customerNameFor, externalRefFor, LEAD_TIER, tierFor, UNNAMED_CUSTOMER } from "@users/domain/business/plan/mod.ts";
import { isPlaceholderName } from "@users/domain/business/placeholder-name/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import type { UserPlan } from "@users/dto/plan.ts";
import type { User } from "@users/dto/user.ts";

/** pure: the CRM customer an account reads as, right now — REQ-062: named "unknown dragon
 *  mcdragonson" until the person says who they are, its tier the plan's (Lead until paid) */
export const LEAD_SOURCE = "paperworkmonster.com";

/** REQ-070 — a value the account has, trimmed; nothing when it has none (the CRM then leaves its column alone) */
function said(value: string | undefined): string | undefined {
  const v = (value ?? "").trim();
  return v === "" ? undefined : v;
}

export function customerFor(
  user: User,
  identity: Partial<BusinessIdentity> | null,
  plan: UserPlan | null,
  address: Partial<BusinessAddress> | null = null,
  insurance: Partial<BusinessInsurance> | null = null,
): NewCustomer {
  const name = isPlaceholderName(user.name) ? undefined : user.name;
  // REQ-111 — the selected plan and the exact stage reached, always said: the team's follow-up reads them
  const progress = signupProgress({ user, identity: identity as BusinessIdentity | null, address: address as BusinessAddress | null, insurance: insurance as BusinessInsurance | null, plan });
  // REQ-070 — the profile the CRM's lead columns show: the person (never the placeholder), the
  // business's city and state, its website, and that they came from this app
  const profile: Pick<NewCustomer, "contact" | "city" | "state" | "website" | "leadSource"> = {
    ...(said(name) ? { contact: said(name) } : {}),
    ...(said(address?.city) ? { city: said(address?.city) } : {}),
    ...(said(address?.state) ? { state: said(address?.state)?.toUpperCase() } : {}),
    ...(said(identity?.websiteUrl) ? { website: said(identity?.websiteUrl) } : {}),
    leadSource: LEAD_SOURCE,
  };
  return {
    customerName: customerNameFor({ name, email: user.email, phoneNumber: user.phoneNumber }, identity),
    customerEmail: user.email?.trim() ?? "",
    customerPhone: user.phoneNumber?.trim() || undefined,
    externalRef: externalRefFor(user.id),
    tier: tierFor(plan),
    ...profile,
    signupPlan: progress.plan || "none yet",
    signupStage: progress.stage,
  };
}

@Injectable()
export class CrmCustomerSync {
  constructor(
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private link: PaymentsLink,
    private plans: PlanStore,
    private address: BusinessAddressStore = new BusinessAddressStore(),
    private insurance: BusinessInsuranceStore = new BusinessInsuranceStore(),
  ) {}

  /**
   * the account's CRM customer, made or revised from what the account says now. Called by the
   * outbox's sweep (REQ-098/099: never inside a request's reply) and by the paid pick, whose pay
   * link needs the customerId.
   * @throws payments-unavailable — the CRM did not answer: the sweep defers and retries
   */
  async ensure(userId: string): Promise<{ customerId: string }> {
    const [user, identity, plan, address, insurance] = await Promise.all([this.users.get(userId), this.identity.get(userId), this.plans.get(userId), this.address.get(userId), this.insurance.get(userId)]);
    return await this.link.createCustomer(customerFor(user, identity, plan, address, insurance));
  }

  /** REQ-060 — the phone typed into login is a CRM lead at once, unnamed, no email, no ref;
   *  REQ-072 — the CRM's refusal is thrown: the outbox sweep (CrmLeadCapture) decides the retry */
  capture(phoneNumber: string): Promise<{ customerId: string }> {
    const phone = normalizePhone(phoneNumber);
    return this.link.createCustomer({ customerName: UNNAMED_CUSTOMER, customerEmail: "", customerPhone: phone, tier: LEAD_TIER, leadSource: LEAD_SOURCE });
  }

  /** what the CRM holds for this account; null before its first sync */
  read(userId: string): Promise<CrmCustomer | null> {
    return this.link.findCustomer(externalRefFor(userId));
  }
}
