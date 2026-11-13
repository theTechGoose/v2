/**
 * REQ-502 — demo-loop cycle 3, issue p8-pair10-b: "'CA' vs 'CJ' avatars
 * disagree". Carl (one-word name) of Jensen Electric LLC saw "CJ" on the
 * dashboard sidebar (the server's computeInitials pairs a one-word name with
 * the business initial) but "CA" on his public quote's sender avatar
 * (doc-parts initialsFromName took two letters) and in the front-end
 * fallback (greeting-identity deriveInitials). One shared rule now lives in
 * shared/identity/initials.ts and every avatar goes through it.
 */
import * as fs from "fs";
import * as path from "path";
import {
  computeInitials,
  senderInitials,
} from "../../shared/identity/initials";
import {
  sidebarIdentity,
  withSavedName,
} from "../../front-end/lib/greeting-identity";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const t = (key: string) => key;

describe("REQ-502 (demo cycle 3, p8-pair10-b) one initials rule for every avatar", () => {
  test("REQ-502 the shared rule pairs a one-word name with the business: Carl + Jensen Electric LLC → CJ", () => {
    expect(computeInitials("Carl", "Jensen Electric LLC")).toBe("CJ");
    expect(computeInitials("Carl Jensen")).toBe("CJ");
    expect(computeInitials("Carl")).toBe("CA");
    expect(computeInitials(undefined, "Jensen Electric LLC")).toBe("JE");
    expect(computeInitials(undefined)).toBe("?");
  });

  test("REQ-502 a sender name that IS the business name reads as the business (outbound display fallback)", () => {
    expect(computeInitials("Jensen Electric LLC", "Jensen Electric LLC"))
      .toBe("JE");
  });

  test("REQ-502 the document sender avatar uses the same rule, with a brand fallback", () => {
    expect(
      senderInitials(
        { name: "Carl", businessName: "Jensen Electric LLC" },
        "DocuMonster",
      ),
    ).toBe("CJ");
    expect(senderInitials({ businessName: "Jensen Electric LLC" }, "X"))
      .toBe("JE");
    expect(senderInitials(undefined, "DocuMonster")).toBe("DO");
    expect(senderInitials({ name: "  " }, "PM")).toBe("PM");
  });

  test("REQ-502 the sidebar's local fallback agrees with the server: Carl of Jensen Electric → CJ", () => {
    const profile = {
      user: { name: "Carl" },
      identity: { businessName: "Jensen Electric LLC" },
      initials: null,
    };
    expect(sidebarIdentity(profile, t)?.initials).toBe("CJ");
    const saved = withSavedName(
      { ...profile, user: { name: "Nuevo usuario" } },
      "Carl",
    );
    expect(saved.initials).toBe("CJ");
    expect(sidebarIdentity(saved, t)?.initials).toBe("CJ");
  });

  test("REQ-502 the public quote/invoice avatar renders through the shared rule, not a local two-letter one", () => {
    const doc = read("front-end/components/quote-doc.tsx");
    expect(doc).toMatch(/senderInitials\w*\(\s*contractor/);
    expect(doc).not.toMatch(/initialsFromName\(/);
    expect(read("front-end/components/doc-parts.tsx")).not.toMatch(
      /function initialsFromName/,
    );
    expect(read("front-end/lib/greeting-identity.ts")).toMatch(
      /shared\/identity\/initials/,
    );
  });

  test("REQ-502 the backend's computeInitials and the email avatar come from the shared module", () => {
    expect(read("backend/src/users/domain/business/initials/mod.ts")).toMatch(
      /shared\/identity\/initials/,
    );
    const email = read(
      "backend/src/paperwork/domain/coordinators/send-paperwork-email/mod.ts",
    );
    expect(email).toMatch(/senderInitials\w*\(/);
    expect(email).not.toMatch(/parts\.slice\(0, 2\)|parts\[0\]\.slice\(0, 2\)/);
  });
});
