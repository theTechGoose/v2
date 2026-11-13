/**
 * REQ-160 — which logo heads a paperwork email: the sending business's own
 * when it has one on file. The business's logo is reached through the
 * public-logo route (the document's id grants it, as on the public page), so
 * the email never carries a file id. REQ-613: the URL carries the logo's
 * version, so a replaced logo is a new URL no mail client can serve stale.
 *
 * REQ-628 — A2Z Landscape, 2026-11-12: "They NEED THEIR LOGO NOT OURS". With
 * no logo on file the email is headed by the business's name as a text
 * wordmark — never the DocuMonster logo. Pure.
 */
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { logoVersion, publicLogoUrl } from "#quote-flow/public-logo-url.ts";

export type EmailLogo =
  | { kind: "image"; src: string; alt: string }
  | { kind: "wordmark"; text: string };

export function emailLogo(input: {
  appUrl: string;
  kind: "quote" | "invoice";
  id: string;
  biz:
    | Pick<BusinessIdentity, "businessName" | "logoFileId" | "legalName">
    | undefined
    | null;
  /** who the wordmark names when the business has no name on file (the contractor) */
  fallbackName?: string;
}): EmailLogo {
  const name = input.biz?.businessName?.trim() || input.biz?.legalName?.trim();
  if (input.biz?.logoFileId) {
    return {
      kind: "image",
      src: publicLogoUrl(
        input.kind,
        input.id,
        logoVersion(input.biz.logoFileId),
        input.appUrl,
      ),
      alt: name || "Logo",
    };
  }
  return { kind: "wordmark", text: name || input.fallbackName?.trim() || "" };
}

/** REQ-628: the email's header markup — the logo scaled into a fixed
 *  200×64 box keeping its aspect ratio, or the name as a wordmark; nothing
 *  when there is no name at all. */
export function emailLogoHtml(
  logo: EmailLogo,
  opts: { align?: "left" | "center"; color?: string } = {},
): string {
  const align = opts.align ?? "center";
  const margin = align === "center" ? "0 auto" : "0";
  if (logo.kind === "image") {
    return `<img data-biz-logo src="${esc(logo.src)}" alt="${
      esc(logo.alt)
    }" style="display:block;margin:${margin};border:0;outline:none;text-decoration:none;width:auto;height:auto;max-width:200px;max-height:64px;">`;
  }
  if (!logo.text) return "";
  return `<div data-biz-wordmark style="text-align:${align};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:22px;letter-spacing:-0.01em;line-height:1.15;color:${
    opts.color ?? "#144852"
  };">${esc(logo.text)}</div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
      ? "&lt;"
      : c === ">"
      ? "&gt;"
      : c === '"'
      ? "&quot;"
      : "&#39;");
}
