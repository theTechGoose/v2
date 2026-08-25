/**
 * PDF p5 — professionalize the user's "Write it myself" text: break it down
 * into professional line items the UI can offer for accept-or-edit.
 *
 * CONTRACT NOTE (declared in TDD-QUOTE-FLOW.md): the shipped
 * POST /agents/job-details/professionalize is a single-bullet cleanup
 * ({ text } → { text }). The green phase EXTENDS it: when called with
 * { details } (multi-line raw input) it returns { items: string[] } — the
 * professional breakdown. The legacy { text } shape keeps working.
 */
import { type ApiSession, contractor } from "./helpers/api";

describe("POST /agents/job-details/professionalize — multi-line breakdown", () => {
  let s: ApiSession;

  beforeAll(async () => {
    s = await contractor("+15125550911");
  });

  it("returns professionalized line items for raw casual input", async () => {
    const raw = "tear out the old fence\nput up new panels\nhaul away the junk";
    const { status, body } = await s.post(
      "/agents/job-details/professionalize",
      {
        details: raw,
      },
    );
    expect(status).toBe(200);
    const items: string[] = body.items ?? [];
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);
    // It must actually transform, not echo.
    expect(items.join("\n").toLowerCase()).not.toBe(raw.toLowerCase());
  });

  it("keeps the scope faithful — the breakdown stays about the described job", async () => {
    const { body } = await s.post("/agents/job-details/professionalize", {
      details: "fix the gate",
    });
    const items: string[] = body.items ?? [];
    expect(items.length).toBeGreaterThanOrEqual(1);
    // Every item must relate to the described work — no invented rooms,
    // trades, or unrelated add-ons.
    expect(items.join(" ")).toMatch(/gate|hinge|latch|hardware|fence/i);
    expect(items.join(" ")).not.toMatch(
      /kitchen|roof|plumbing|electrical|painting the house/i,
    );
  });

  it("the legacy single-bullet shape ({ text } → { text }) keeps working", async () => {
    const { status, body } = await s.post(
      "/agents/job-details/professionalize",
      {
        text: "fix the gate",
      },
    );
    expect(status).toBe(200);
    expect(typeof body.text).toBe("string");
    expect(body.text.trim().length).toBeGreaterThan(0);
  });

  it("rejects empty input instead of hallucinating a job", async () => {
    const { status } = await s.post("/agents/job-details/professionalize", {
      details: "",
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });
});
