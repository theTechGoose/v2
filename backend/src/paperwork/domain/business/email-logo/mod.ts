/**
 * REQ-160 — which logo heads a paperwork email: the sending business's own
 * when it has one on file, the house logo otherwise. The business's logo is
 * reached through the public-logo route (the document's id grants it, as on
 * the public page), so the email never carries a file id. Pure.
 */
import type { BusinessIdentity } from "@users/dto/business-identity.ts";

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
      src: `${input.appUrl}/api/public-logo/${input.kind}/${input.id}`,
      alt: input.biz.businessName?.trim() || "Logo",
    };
  }
  return { src: `${input.appUrl}/logo-email.png`, alt: "DocuMonster" };
}
