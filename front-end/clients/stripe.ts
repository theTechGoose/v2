/** REQ-212 — the business's own Stripe connection: /me/stripe. The secret never comes back. */
import { api, type ApiOptions } from "../lib/api.ts";

export interface StripeMerchant {
  name: string;
  hasLogo: boolean;
  logoFileId?: string;
}
export type StripeStatus =
  | { connected: false; merchant: StripeMerchant }
  | {
    connected: true;
    mode: "test" | "live";
    fake: boolean;
    publishableKey: string;
    secretMasked: string;
    accountId: string;
    accountName: string;
    connectedAt: string;
    merchant: StripeMerchant;
  };

export const stripeClient = {
  status: (opts: ApiOptions = {}) => api.get<StripeStatus>("/me/stripe", opts),
  connect: (publishableKey: string, secretKey: string, opts: ApiOptions = {}) =>
    api.put<StripeStatus>("/me/stripe", { publishableKey, secretKey }, opts),
  disconnect: (opts: ApiOptions = {}) =>
    api.delete<StripeStatus>("/me/stripe", opts),
};
