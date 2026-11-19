import type { Lang } from "@core/i18n/mod.ts";

/**
 * REQ-1016 / REQ-1033: the opening of every email document. The root element
 * declares the language the email is written in, so screen readers and mail
 * clients' translate prompts read it right. Every email template starts with
 * this instead of its own copy of a root element with no lang attribute.
 */
export function emailRoot(lang: Lang): string {
  return `<!doctype html>\n<html lang="${lang}">`;
}
