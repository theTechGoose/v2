/**
 * REQ-160 — which logo heads a paperwork email: the sending business's own
 * when it has one on file, the house logo otherwise. The business's logo is
 * reached through the public-logo route (the document's id grants it, as on
 * the public page), so the email never carries a file id. REQ-613: the URL carries the logo's
 * version, so a replaced logo is a new URL no mail client can serve stale. Pure.
 */
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { logoVersion, publicLogoUrl } from "#quote-flow/public-logo-url.ts";

export interface EmailLogo {
  src: string;
  alt: string;
}

export function emailLogo(input: {
  appUrl: string;
  kind: "quote" | "invoice";
  id: string;
  biz: Pick<BusinessIdentity, "businessName" | "logoFileId"> | undefined;
}): EmailLogo {
  if (input.biz?.logoFileId) {
    return {
      src: publicLogoUrl(
        input.kind,
        input.id,
        logoVersion(input.biz.logoFileId),
        input.appUrl,
      ),
      alt: input.biz.businessName?.trim() || "Logo",
    };
  }
  return { src: `${input.appUrl}/logo-email.png`, alt: "DocuMonster" };
}
