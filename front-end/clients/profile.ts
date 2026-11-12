/**
 * HTTP client for the /settings page.
 *
 * Backend reference: users/entrypoints/profile-composite-controller/mod.ts
 *   GET /profile                       → ProfileSnapshot (auth)
 */
import { api, type ApiOptions } from "../lib/api.ts";
import type { NumberingStarts } from "../../shared/documents/numbering.ts";
import type { NumberingView } from "../../shared/documents/numbering-settings.ts";

export type { NumberingStarts, NumberingView };

export interface BusinessIdentity {
  userId: string;
  /** Backend persists this as `businessName`. We expose both names from
   *  the same field so older callers reading `displayName` keep working. */
  businessName?: string;
  displayName?: string;
  legalName?: string;
  businessLicense?: string;
  logoFileId?: string;
  logoUrl?: string;
  tagline?: string;
  websiteUrl?: string;
  /** REQ-174: the default days a customer has to pay an invoice */
  invoiceNetDays?: number;
  /** Language the contractor's customers receive outbound comms in
   *  (quotes/SMS/email/docs). Distinct from the contractor's UI language.
   *  Defaults to "en" when unset. Stays the DEFAULT (first enabled). */
  commsLanguage?: string;
  /** The set of languages the contractor can SEND paperwork in — drives the
   *  Settings checkboxes and the "Send in" buttons on the quote-review card.
   *  Unset → derive from `commsLanguage` (or ["en"]). */
  commsLanguages?: string[];
  /** REQ-172: the business's IANA time zone (the 9 am schedule texts follow it) */
  timezone?: string;
  /** Per-method enable flags + handles (Venmo @, Zelle email, etc.).
   *  Shape mirrors backend AcceptedPaymentMethods but kept permissive so
   *  consumers only need the .enabled flag for gating logic. */
  acceptedPaymentMethods?: Partial<
    Record<
      | "check"
      | "venmo"
      | "zelle"
      | "cashapp"
      | "paypal"
      | "cash"
      | "ach"
      | "card"
      | "other",
      {
        enabled?: boolean;
        handle?: string;
        cashtag?: string;
        mailTo?: string;
        routingNumber?: string;
        accountNumberMasked?: string;
        instructions?: string;
      }
    >
  >;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessAddress {
  userId: string;
  street?: string;
  unit?: string;
  city?: string;
  state?: string;
  postal?: string;
  country?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessInsurance {
  userId: string;
  provider?: string;
  policyNumber?: string;
  coverageCents?: number;
  expiresAt?: string;
  /** Pointer to the uploaded proof-of-insurance file (files module). */
  insuranceFileId?: string;
  insuranceUploadedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContractDefaults {
  userId: string;
  paymentTermsDays?: number;
  depositPct?: number;
  warrantyDays?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileUser {
  id: string;
  phoneNumber: string;
  name?: string;
  email?: string;
  language?: "en" | "es";
  /** Super-admin flag — drives the sidebar Admin tab. Server-enforced. */
  superAdmin?: boolean;
  /** ISO timestamp of the first time the user reached the end of the /welcome
   *  wizard or left it. A record, not a gate (REQ-091): the wizard returns
   *  until every question is answered. */
  onboardedAt?: string;
  /** Whether that first time was a skip vs. a real finish. */
  onboardingSkipped?: boolean;
  /** REQ-227: question → ISO time its wizard step's Skip was pressed */
  onboardingDeferred?: Partial<Record<string, string>>;
  createdAt: number;
  updatedAt: number;
}

/** REQ-054 — the plan picked in onboarding or settings. Mirrors backend users/dto/plan.ts. */
export type PlanId = "free" | "monster" | "assist" | "test";
export interface UserPlan {
  userId: string;
  planId: PlanId;
  /** free — stored free; pending — a paid pick waiting on its pay page; active — the due settled;
   *  past_due — REQ-061: the latest month could not be collected, its pay page is payUrl */
  status: "free" | "pending" | "active" | "past_due";
  chosenAt: string;
  activatedAt?: string;
  customerId?: string;
  dueId?: string;
  /** the CRM's pay page: the first month's while pending, the past-due month's while past due */
  payUrl?: string;
  /** REQ-061 — the CRM's monthly billing behind an active plan */
  subscriptionId?: string;
  nextBillAt?: string;
  cardBrand?: string;
  cardLast4?: string;
  /** REQ-064 — the merchant account the pick named; absent = the CRM's default */
  merchant?: string;
  /** REQ-127 — a pending upgrade: what its due is for (the difference) and the plan it comes from;
   *  a downgrade: the plan it came from and when the cheaper billing starts */
  dueCents?: number;
  switchedFrom?: PlanId;
  firstBillAt?: string;
  /** REQ-129 — what the first month paid through (a month after activation), and what the next
   *  bill is for: the prorated days to the month's end on the first 1st, the full price after */
  paidThrough?: string;
  nextBillCents?: number;
  /** REQ-106 — on a pending pick with no page yet: the CRM has no account by that name (final), or
   *  the link builder has not answered (still being tried). Absent and no payUrl = being prepared. */
  payLinkError?: "merchant-unknown" | "payments-unavailable";
  updatedAt: string;
}

export interface ProfileSnapshot {
  user: ProfileUser;
  identity: BusinessIdentity | null;
  address: BusinessAddress | null;
  insurance: BusinessInsurance | null;
  tax: { tinMasked?: string; w9FileId?: string; w9UploadedAt?: string } | null;
  contractDefaults: ContractDefaults | null;
  references: unknown[];
  /** REQ-054 — null until a pick (read as free) */
  plan?: UserPlan | null;
  initials: string;
  /** REQ-198 — the account's own number ("DM-0001") */
  accountNumber?: string;
  /** Phone-area-code guess for the business state — present only when we
   *  have a guess AND no address state is set yet. Drives the /welcome
   *  wizard's tap-to-confirm state pre-selection. */
  suggestedState?: string;
}

export const profileClient = {
  get: (opts: ApiOptions = {}) => api.get<ProfileSnapshot>("/profile", opts),
  /** PATCH the authenticated user (name, email, language). */
  updateUser: (patch: Record<string, unknown>, opts: ApiOptions = {}) =>
    api.put<ProfileUser>("/me", patch, opts),
  /** PATCH the business identity (businessName, logoFileId, acceptedPaymentMethods, …). */
  updateIdentity: (patch: Record<string, unknown>, opts: ApiOptions = {}) =>
    api.put<BusinessIdentity>("/profile/identity", patch, opts),
  /** PUT the mailing address (street, city, state, postal, country). */
  updateAddress: (patch: Record<string, unknown>, opts: ApiOptions = {}) =>
    api.put<BusinessAddress>("/profile/address", patch, opts),
  /** PUT insurance details (provider, policyNumber, coverageCents, expiresAt, insuranceFileId). */
  updateInsurance: (patch: Record<string, unknown>, opts: ApiOptions = {}) =>
    api.put<BusinessInsurance>("/profile/insurance", patch, opts),
  /** PUT W-9 + TIN (w9FileId, tin). Server hashes/masks the TIN; never stores it raw. */
  updateTax: (
    patch: Record<string, unknown>,
    opts: ApiOptions = {},
  ) =>
    api.put<{ tinMasked?: string; w9FileId?: string; w9UploadedAt?: string }>(
      "/profile/tax",
      patch,
      opts,
    ),
  /** Irreversibly wipe the authenticated account and 100% of its data.
   *  Hits GET /me/wipe (scoped to the caller's session) and logs them out. */
  wipeAccount: (opts: ApiOptions = {}) =>
    api.get<{ ok: true; deleted: number }>("/me/wipe", opts),
  /** REQ-198/199 — the account number, the starting numbers, the next number
   *  of every kind and which kinds already issued (locked). */
  numbering: (opts: ApiOptions = {}) =>
    api.get<NumberingView>("/profile/numbering", opts),
  /** REQ-199 — set starting numbers (only the changed kinds). 409
   *  `numbering_locked` {kinds} when a kind already issued a number. */
  updateNumbering: (patch: NumberingStarts, opts: ApiOptions = {}) =>
    api.put<NumberingView>("/profile/numbering", patch, opts),
  /** REQ-199 — clear every record of the account (customers, quotes,
   *  invoices, change orders, work orders, payments) and restart numbering;
   *  keeps the account, its settings and this session. Owner only. */
  setupReset: (opts: ApiOptions = {}) =>
    api.post<{ ok: true }>("/me/setup-reset", undefined, opts),
  /** REQ-220 (+ AMENDMENT: no code) — "Transfer account": the account moves onto
   *  `phoneNumber` at once and this session ends. 409 `same_number` | `phone_taken`,
   *  400 `bad_phone`; 403 for an admin acting for the account. */
  transferAccount: (phoneNumber: string, opts: ApiOptions = {}) =>
    api.post<{ ok: true; phoneNumber: string }>(
      "/me/transfer",
      { phoneNumber },
      opts,
    ),
};

/** REQ-058 — the CRM customer this account is (null before the first sync). Mirrors the backend's CrmCustomer. */
export interface CrmCustomer {
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  externalRef?: string;
}

/** REQ-054 — the plan: pick one; REQ-133 — every read of a pending one asks the CRM of its due (nothing to refresh). */
export const planClient = {
  get: (opts: ApiOptions = {}) => api.get<UserPlan | null>("/me/plan", opts),
  choose: (planId: PlanId, opts: ApiOptions = {}) =>
    api.post<UserPlan>("/me/plan", { planId }, opts),
  /** REQ-058 — what the CRM holds for this account */
  crmCustomer: (opts: ApiOptions = {}) =>
    api.get<CrmCustomer | null>("/me/crm-customer", opts),
  /** REQ-057 — what the app's stand-in pay page presses: settles the due on the fake (404 on the real client) */
  fakePaid: (dueId: string, opts: ApiOptions = {}) =>
    api.post<UserPlan>("/me/plan/fake-paid", { dueId }, opts),
};
