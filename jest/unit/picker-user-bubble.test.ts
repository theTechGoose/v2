/**
 * REQ-577 — demo-loop cycle 4, issue m38 (pair 7): "User's first message
 * hidden while options generate".
 *
 * In "help me price it" the contractor types the job and sends it;
 * submitJobDetails keeps the text in `submittedJobDetails` and opens the
 * job-options picker. While `jobOptionsOpen` is true the picker panel
 * replaces the whole scroll area (the message list is not rendered), and the
 * panel showed only its heading, "Writing up your options…" and then the
 * cards — never what she typed. The message only appeared after Continue.
 *
 * The picker panel (confirm mode) now opens with her message as a user
 * bubble, above the loading line and above the options alike.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const island = () =>
  readFileSync(resolve(ROOT, "front-end/islands/AsstChat.tsx"), "utf8");

/** the picker panel's markup: from `<div class="chat__jobopts">` to its loading/options switch */
function pickerHead(src: string): string {
  const start = src.indexOf('<div class="chat__jobopts">');
  expect(start).toBeGreaterThan(-1);
  // REQ-662 (cycle 5, m19): the switch is on optionsLoading alone now.
  const sw = src.indexOf("{optionsLoading\n", start);
  expect(sw).toBeGreaterThan(start);
  return src.slice(start, sw);
}

describe("REQ-577 (cycle 4, m38) the picker shows the contractor's message while options generate", () => {
  test("the picker panel renders submittedJobDetails as a user bubble before the loading/options switch", () => {
    const head = pickerHead(island());
    expect(head).toMatch(/data-cy="picker-user-bubble"/);
    expect(head).toMatch(/chat__details-user-bubble/);
    expect(head).toMatch(/\{submittedJobDetails\}/);
  });

  test("the bubble is shown in confirm mode (help me price it) whenever a message was submitted", () => {
    const head = pickerHead(island());
    expect(head).toMatch(
      /pickerMode === "confirm" && submittedJobDetails/,
    );
  });

  test("the bubble sits outside the loading branch, so it stays once the options land", () => {
    const src = island();
    const start = src.indexOf('<div class="chat__jobopts">');
    const loading = src.indexOf('<div class="chat__jobopts-loading">', start);
    const bubble = src.indexOf('data-cy="picker-user-bubble"', start);
    expect(bubble).toBeGreaterThan(start);
    expect(bubble).toBeLessThan(loading);
  });
});
