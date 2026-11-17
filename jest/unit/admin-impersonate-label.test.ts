/**
 * REQ-426 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 2, issue p13-e ("Impersonate dropdown label changes
 * from person name to business name").
 *
 * RCA: the /admin impersonate option was labelled
 * `u.businessName || displayName(u.name)` + " · " + phone. Deb had no
 * business before the demo, so the option read "Deb Kowalski · …"; she set
 * "Sparkle Home Cleaning" during it and the 5 s live refresh (REQ-301)
 * re-labelled the same option with the business. One stable label instead:
 * person first, business when present, phone last.
 */
import * as fs from "fs";
import * as path from "path";
import { impersonateLabel } from "../../front-end/lib/admin-console";

const ROOT = path.resolve(__dirname, "../..");
const NO_NAME = "(no name yet)";

describe("REQ-426 (demo cycle 2, p13-e): stable impersonate option label", () => {
  const deb = {
    id: "u1",
    name: "Deb Kowalski",
    phoneNumber: "+15125550102",
  };

  it("person first, then business when present, then phone", () => {
    expect(
      impersonateLabel(
        { ...deb, businessName: "Sparkle Home Cleaning" },
        NO_NAME,
      ),
    ).toBe("Deb Kowalski · Sparkle Home Cleaning · (512) 555-0102");
  });

  it("no business: person · phone", () => {
    expect(impersonateLabel(deb, NO_NAME)).toBe(
      "Deb Kowalski · (512) 555-0102",
    );
    expect(impersonateLabel({ ...deb, businessName: "  " }, NO_NAME)).toBe(
      "Deb Kowalski · (512) 555-0102",
    );
  });

  it("setting a business keeps the person's name leading the label", () => {
    const before = impersonateLabel(deb, NO_NAME);
    const after = impersonateLabel(
      { ...deb, businessName: "Sparkle Home Cleaning" },
      NO_NAME,
    );
    expect(after.startsWith("Deb Kowalski · ")).toBe(true);
    expect(before.split(" · ")[0]).toBe(after.split(" · ")[0]);
  });

  it("a placeholder name reads as the no-name text, business still shown", () => {
    expect(
      impersonateLabel(
        { ...deb, name: "New user", businessName: "Sparkle Home Cleaning" },
        NO_NAME,
      ),
    ).toBe("(no name yet) · Sparkle Home Cleaning · (512) 555-0102");
  });

  it("AdminPage's option renders impersonateLabel, not businessName || name", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "front-end/islands/AdminPage.tsx"),
      "utf8",
    );
    const sel = src.slice(src.indexOf('id="impersonate-select"'));
    const option = sel.slice(0, sel.indexOf("</select>"));
    expect(option).toMatch(/\{impersonateLabel\(u, noName\)\}/);
    expect(option).not.toMatch(/u\.businessName \|\|/);
  });
});
