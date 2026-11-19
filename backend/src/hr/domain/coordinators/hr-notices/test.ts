/**
 * REQ-1003 (LOOP-007 q1, q1-88) — the new hire's email names the business that is hiring them.
 * The invite/reminder email strings render with the company the hire is joining, in both
 * dictionaries; today only reminderBody has a {company} slot.
 */
import { assertStringIncludes } from "#std/assert";
import { type Lang, t } from "@core/i18n/mod.ts";

const v = {
  first: "Jose",
  company: "Reyes Lawn & Landscape",
  url: "https://documonster.com/sign/tok",
};

for (const lang of ["en", "es"] as Lang[]) {
  for (
    const key of [
      "hr.email.inviteSubject",
      "hr.email.inviteHeadline",
      "hr.email.inviteBody",
      "hr.email.reminderSubject",
    ]
  ) {
    Deno.test(`REQ-1003 ${lang} ${key} names the hiring business`, () => {
      assertStringIncludes(t(lang, key, v), v.company);
    });
  }
}
