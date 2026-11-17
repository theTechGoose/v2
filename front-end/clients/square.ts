/** REQ-803 — the business's own Square connection: /me/square. The token never comes back. */
import { api, type ApiOptions } from "../lib/api.ts";
import type { StripeMerchant } from "./stripe.ts";

export type SquareStatus =
  | {
    connected: false;
    merchant: StripeMerchant;
    /** the other card provider that is on (one at a time) */
    otherProvider: "stripe" | null;
  }
  | {
    connected: true;
    environment: "production" | "sandbox";
    fake: boolean;
    tokenMasked: string;
    locationId: string;
    locationName: string;
    sellerName: string;
    connectedAt: string;
    merchant: StripeMerchant;
    otherProvider: null;
  };

export const squareClient = {
  status: (opts: ApiOptions = {}) => api.get<SquareStatus>("/me/square", opts),
  connect: (accessToken: string, locationId: string, opts: ApiOptions = {}) =>
    api.put<SquareStatus>("/me/square", { accessToken, locationId }, opts),
  disconnect: (opts: ApiOptions = {}) =>
    api.delete<SquareStatus>("/me/square", opts),
};
