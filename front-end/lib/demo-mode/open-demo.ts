/**
 * REQ-179 + REQ-864 (cycle dm4, p8) — /admin's Demo click, start to page move.
 *
 * The row is marked busy (the button reads Opening…) and the overlay is told at once
 * (DEMO_OPENING_EVENT); the server opens the demo; the overlay gets it straight
 * (DEMO_STARTED_EVENT) and places the presenter — whoami, impersonate, then the move to the
 * stage. The row stays busy through all of that: it is released only when start fails, or when
 * the overlay says placing ended without moving (DEMO_PLACE_FAILED_EVENT). Clearing it when
 * start answered made the button read Demo for the ~200 ms before the page moved.
 */
import {
  DEMO_OPENING_EVENT,
  DEMO_PLACE_FAILED_EVENT,
  DEMO_STARTED_EVENT,
  type DemoStarted,
} from "../../clients/demo-mode.ts";

export interface OpenDemoDeps {
  start: (userId: string) => Promise<DemoStarted>;
  /** the busy row: the id while opening, null when released */
  setBusy: (id: string | null) => void;
  /** a failed start: the page's own error / lock handling */
  fail: (err: unknown) => Promise<void>;
  /** the row is re-read the moment a demo opens */
  refresh: () => void;
  win?: EventTarget;
}

export async function openDemo(
  id: string,
  targetName: string,
  deps: OpenDemoDeps,
): Promise<void> {
  const win = deps.win ?? globalThis;
  deps.setBusy(id);
  const onPlaceFailed = () => {
    win.removeEventListener(DEMO_PLACE_FAILED_EVENT, onPlaceFailed);
    deps.setBusy(null);
  };
  // heard before the started event: the overlay may fail placing on its very first await
  win.addEventListener(DEMO_PLACE_FAILED_EVENT, onPlaceFailed);
  win.dispatchEvent(
    new CustomEvent(DEMO_OPENING_EVENT, {
      detail: { targetUserId: id, targetName },
    }),
  );
  let started: DemoStarted;
  try {
    started = await deps.start(id);
  } catch (err) {
    win.removeEventListener(DEMO_PLACE_FAILED_EVENT, onPlaceFailed);
    await deps.fail(err);
    // no detail: the overlay asks the server and clears its Opening… pill
    win.dispatchEvent(new Event(DEMO_STARTED_EVENT));
    deps.setBusy(null);
    return;
  }
  win.dispatchEvent(
    new CustomEvent(DEMO_STARTED_EVENT, { detail: { ...started, targetName } }),
  );
  deps.refresh();
}
