import { assert, assertEquals } from "@std/assert";
import {
  clearDockRoom,
  DOCK_CLASS,
  DOCK_VAR,
  setDockRoom,
} from "./threads-dock-room.ts";

/**
 * REQ-724 (demo-loop cycle 5, issue M27): on a phone the Conversations dock was a z-index 61
 * overlay over the ☰ drawer's lower 42vh, so "Worker view" and "Log out" sat under it. The
 * drawer now reserves the dock's measured height: the dock publishes it as `--threads-dock-h`
 * on `.sb` and flags the drawer `sb--threads-docked`, whose CSS pads its bottom by it.
 */

function fakeSb() {
  const props = new Map<string, string>();
  const classes = new Set<string>();
  return {
    props,
    classes,
    style: {
      setProperty: (n: string, v: string) => void props.set(n, v),
      removeProperty: (n: string) => void props.delete(n),
    },
    classList: {
      toggle: (c: string, on?: boolean) => {
        const want = on ?? !classes.has(c);
        if (want) classes.add(c);
        else classes.delete(c);
        return want;
      },
    },
  };
}

Deno.test("REQ-724: the dock's height is reserved on the drawer, rounded up to whole px", () => {
  const sb = fakeSb();
  setDockRoom(sb, 353.4);
  assertEquals(sb.props.get(DOCK_VAR), "354px");
  assert(sb.classes.has(DOCK_CLASS), "the drawer is flagged as docked");
});

Deno.test("REQ-724: the reserve follows the dock as it grows or shrinks", () => {
  const sb = fakeSb();
  setDockRoom(sb, 354);
  setDockRoom(sb, 120);
  assertEquals(sb.props.get(DOCK_VAR), "120px");
  assert(sb.classes.has(DOCK_CLASS));
});

Deno.test("REQ-724: no dock (closed drawer, wide window, zero height) releases the room", () => {
  const sb = fakeSb();
  setDockRoom(sb, 354);
  clearDockRoom(sb);
  assertEquals(sb.props.has(DOCK_VAR), false);
  assertEquals(sb.classes.has(DOCK_CLASS), false);
  setDockRoom(sb, 200);
  setDockRoom(sb, 0);
  assertEquals(sb.props.has(DOCK_VAR), false, "a 0 px dock reserves nothing");
  assertEquals(sb.classes.has(DOCK_CLASS), false);
});

Deno.test("REQ-724: the stylesheet pads the docked drawer by the reserve and lets its inside scroll", async () => {
  const css = await Deno.readTextFile(
    new URL("../static/assistant-page.css", import.meta.url),
  );
  const rule = css.match(/\.sb\.sb--threads-docked\s*\{([^}]*)\}/);
  assert(rule, "a .sb.sb--threads-docked rule exists");
  assert(
    /padding-bottom:\s*var\(--threads-dock-h/.test(rule![1]),
    `it pads the drawer's bottom by --threads-dock-h (${rule![1].trim()})`,
  );
  const inner = css.match(
    /\.sb\.sb--threads-docked\s+\.sb__inner\s*\{([^}]*)\}/,
  );
  assert(
    inner && /overflow-y:\s*auto/.test(inner[1]),
    "the drawer's inside scrolls when short",
  );
});
