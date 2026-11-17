/**
 * REQ-601 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue M12 ("'Share the link' after failed worker
 * text, but no link shown").
 *
 * RCA: after Add on /field/workers, FieldWorkersPage kept only `{ name,
 * texted }`; on texted:false it said "We couldn't text {name} — share the link
 * and PIN yourself." with no link, no copy button, and setForm(BLANK) had
 * already wiped the PIN. The /admins invite ("Let them know yourself.") showed
 * no sign-in address either. Now the add/invite answers `signInUrl` +
 * `shareText` (the exact SMS body, see the backend int tests), `inviteShare`
 * picks them out when the text did not go, and both pages render the link, the
 * PIN (workers) and a Copy button.
 */
import * as fs from "fs";
import * as path from "path";
import { copyShareText, inviteShare } from "../../front-end/lib/invite-share";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const url = "https://documonster.com/worker?lang=es";
const text = `Hank Miller te agregó como trabajador en DocuMonster. Entra en ${url} con este número y tu PIN 4826.`;

describe("REQ-601 (demo cycle 4, M12) a failed invite text shows the link to share", () => {
  test("texted:false with a link and text → the share block", () => {
    expect(inviteShare({ texted: false, signInUrl: url, shareText: text }))
      .toEqual({ url, text });
  });

  test("texted:true → nothing to share (the text went out)", () => {
    expect(inviteShare({ texted: true, signInUrl: url, shareText: text }))
      .toBeNull();
  });

  test("an older server without the link still yields nothing (no blank block)", () => {
    expect(inviteShare({ texted: false })).toBeNull();
  });

  test("copyShareText writes the whole text and reports ok; a missing or failing clipboard is false", async () => {
    const wrote: string[] = [];
    expect(await copyShareText(text, async (s) => {
      wrote.push(s);
    })).toBe(true);
    expect(wrote).toEqual([text]);
    expect(await copyShareText(text, undefined)).toBe(false);
    expect(await copyShareText(text, () => Promise.reject(new Error("no"))))
      .toBe(false);
  });

  test("the copy is in en and es", () => {
    for (
      const k of [
        "field.wk.shareLink",
        "field.wk.copyShare",
        "field.wk.shareCopied",
        "field.wk.shareCopyFailed",
        "admins.shareLink",
        "admins.copyShare",
        "admins.shareCopied",
        "admins.shareCopyFailed",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(es[k]).not.toBe(en[k]);
    }
    expect(en["field.wk.copyShare"]).toBe("Copy link + PIN");
  });

  test("/field/workers keeps the PIN past the reset and renders the link, PIN and Copy", () => {
    const src = read("front-end/islands/FieldWorkersPage.tsx");
    expect(src).toMatch(/pin:\s*form\.pin/);
    expect(src).toContain("inviteShare(made)");
    for (const cy of ["wk-share", "wk-share-url", "wk-share-pin", "wk-share-copy"]) {
      expect(src).toContain(`data-cy="${cy}"`);
    }
  });

  test("/admins renders the sign-in link and Copy when the invite was not texted", () => {
    const src = read("front-end/islands/AdminsPage.tsx");
    expect(src).toContain("inviteShare(");
    for (const cy of ["adm-share", "adm-share-url", "adm-share-copy"]) {
      expect(src).toContain(`data-cy="${cy}"`);
    }
  });
});
