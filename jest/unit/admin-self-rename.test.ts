/**
 * REQ-606 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4 (run r857a9d67), issue m20 ("'(no name yet)' in
 * /admin after saving name").
 *
 * RCA (analyst LIKELY, skeptic UPHELD at ad104a19): on /admin the staff name
 * prompt saves the name (PUT /me) and announces PROFILE_UPDATED; the topbar,
 * sidebar and setup checklist listen, AdminPage did not. Its `rows` (users
 * table, accounts tab, Impersonate list) kept the placeholder — shown as
 * "(no name yet)" — until the next quiet refresh, and that refresh never comes
 * once the page is locked (search() returns early on lockRef, and the lock
 * stops the poll for good). The fix: AdminPage patches its own row from the
 * announcement, independent of the lock and the poll.
 */
import * as fs from "fs";
import * as path from "path";
import {
  displayName,
  onSelfRenamed,
  patchSelfName,
} from "../../front-end/lib/admin-console";
import { PROFILE_UPDATED } from "../../front-end/lib/profile-events";

const ROOT = path.resolve(__dirname, "../..");
const NO_NAME = "(no name yet)";

type Row = { id: string; name?: string; phoneNumber?: string };
const rows: Row[] = [
  { id: "self", name: "Nuevo usuario", phoneNumber: "+15125550101" },
  { id: "cust", name: "New user", phoneNumber: "+15125550102" },
];

function announce(target: EventTarget, detail: unknown) {
  target.dispatchEvent(new CustomEvent(PROFILE_UPDATED, { detail }));
}

describe("REQ-606 (demo cycle 4, m20): /admin follows the staff member's saved name", () => {
  it("patchSelfName renames only the signed-in admin's own row", () => {
    const out = patchSelfName(rows, "self", "Rafa Staff");
    expect(out.map((r) => displayName(r.name, NO_NAME))).toEqual([
      "Rafa Staff",
      NO_NAME,
    ]);
    expect(out[1]).toBe(rows[1]);
    expect(rows[0].name).toBe("Nuevo usuario"); // no mutation
  });

  it("no self id, no matching row, or a placeholder/blank name: the rows are left as they are", () => {
    expect(patchSelfName(rows, undefined, "Rafa")).toBe(rows);
    expect(patchSelfName(rows, "nobody", "Rafa")).toBe(rows);
    expect(patchSelfName(rows, "self", "  ")).toBe(rows);
    expect(patchSelfName(rows, "self", "New user")).toBe(rows);
  });

  it("onSelfRenamed applies a PROFILE_UPDATED name to the self row, and stops on stop()", () => {
    const target = new EventTarget();
    let state: Row[] = rows;
    const setRows = (fn: (rs: Row[]) => Row[]) => {
      state = fn(state);
    };
    const stop = onSelfRenamed("self", setRows, target);
    announce(target, {}); // a profile change that is not a name
    expect(state).toBe(rows);
    announce(target, { name: "Rafa Staff" });
    expect(displayName(state[0].name, NO_NAME)).toBe("Rafa Staff");
    expect(displayName(state[1].name, NO_NAME)).toBe(NO_NAME);
    stop();
    announce(target, { name: "Someone Else" });
    expect(state[0].name).toBe("Rafa Staff");
  });

  it("AdminPage subscribes on mount, outside the lock/poll path (a locked page still follows the rename)", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "front-end/islands/AdminPage.tsx"),
      "utf8",
    );
    expect(src).toMatch(/onSelfRenamed\(\s*selfId\s*,\s*setRows\s*\)/);
    // the subscription is torn down only on unmount, never by the lock effect
    const lockEffect = src.match(
      /useEffect\(\(\) => \{\s*if \(lock\)[\s\S]*?\}, \[lock\]\);/,
    );
    expect(lockEffect).not.toBeNull();
    expect(lockEffect![0]).not.toMatch(/Rename|rename/);
  });
});
