import { assert, assertEquals } from "#std/assert";
import { ProfessionalizeBullet } from "./mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";

/**
 * REQ-332 (demo cycle 1, m30): "Professionalize" changed the meaning — the
 * bullet "4 recesed lights + City of Austin permit" came back as "Install 4
 * recessed lights with permit", re-scoping a job-wide permit onto one item.
 * The one-line pass saw the bullet alone. Now it sees the job (the original
 * message + the sibling bullets), is told never to merge or re-scope, and an
 * "A + B" bullet comes back as two lines.
 */

function fresh() {
  const llm = new StubLLMClient();
  return { llm, flow: new ProfessionalizeBullet(llm) };
}

const RAW =
  "Kitchen refresh for the Nguyens: 4 recesed lights + City of Austin permit, repaint the ceiling, " +
  "swap the faucet. They're buying the vanity themselves.";
const SIBLINGS = ["Repaint kitchen ceiling", "Replace kitchen faucet"];

Deno.test("REQ-332 professionalize: the model sees the original message and the sibling bullets, and is told not to merge or re-scope", async () => {
  const { llm, flow } = fresh();
  let seen: LLMRequest | undefined;
  llm.setHandler((req) => {
    seen = req;
    return {
      text: JSON.stringify({
        lines: ["Install 4 recessed lights", "City of Austin permit"],
      }),
    };
  });
  await flow.run({
    userId: "u-1",
    text: "4 recesed lights + City of Austin permit",
    context: { raw: RAW, siblings: SIBLINGS },
  });
  assert(seen, "llm was called");
  const user = seen!.messages.find((m) => m.role === "user")?.content ?? "";
  assert(
    user.includes("Kitchen refresh for the Nguyens"),
    `the original message reaches the model: ${user}`,
  );
  assert(
    user.includes("Replace kitchen faucet"),
    `the sibling bullets reach the model: ${user}`,
  );
  assert(
    /do not merge/i.test(seen!.systemPrompt),
    "system prompt forbids merging",
  );
  assert(
    /re-?scope/i.test(seen!.systemPrompt),
    "system prompt forbids re-scoping",
  );
  assert(
    /two lines|separate lines/i.test(seen!.systemPrompt),
    "system prompt asks for 'A + B' as separate lines",
  );
});

Deno.test("REQ-332 professionalize: an 'A + B' bullet comes back as two lines (text = the first)", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      lines: ["Install 4 recessed lights", "City of Austin permit"],
    }),
  }));
  const res = await flow.run({
    userId: "u-1",
    text: "4 recesed lights + City of Austin permit",
  });
  assertEquals(res.lines, [
    "Install 4 recessed lights",
    "City of Austin permit",
  ]);
  assertEquals(res.text, "Install 4 recessed lights");
});

Deno.test("REQ-332 professionalize: a model that folds 'A + B' into one line is overruled — the items are split deterministically", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({ text: "Install 4 recessed lights with permit" }),
  }));
  const res = await flow.run({
    userId: "u-1",
    text: "4 recesed lights + City of Austin permit",
  });
  assertEquals(res.lines.length, 2, `two items stay two lines: ${res.lines}`);
  assert(
    /recesed lights/i.test(res.lines[0]) && !/permit/i.test(res.lines[0]),
    res.lines[0],
  );
  assert(/City of Austin permit/i.test(res.lines[1]), res.lines[1]);
});

Deno.test("REQ-332 professionalize: the stub / offline fallback splits 'A + B' too", async () => {
  const { flow } = fresh();
  const res = await flow.run({
    userId: "u-1",
    text: "install 4 recesed lights + City of Austin permit",
  });
  assertEquals(res.lines, [
    "Installation of 4 recesed lights",
    "City of Austin permit",
  ]);
  assertEquals(res.text, "Installation of 4 recesed lights");
});

Deno.test("REQ-332 professionalize: a single-item bullet is still one line, legacy {text} replies still parse", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({ text: "Repaint kitchen ceiling" }),
  }));
  // REQ-675: the rough line carries a typo, so the reply is a real rewrite —
  // a reply that only drops "the" is no longer a polish.
  const res = await flow.run({
    userId: "u-1",
    text: "repaint the kitchen celing",
  });
  assertEquals(res.lines, ["Repaint kitchen ceiling"]);
  assertEquals(res.text, "Repaint kitchen ceiling");
});

Deno.test("REQ-332 professionalize: a returned line that is about something else is discarded for the fallback", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      lines: ["Install 4 recessed lights", "Replace kitchen faucet"],
    }),
  }));
  const res = await flow.run({
    userId: "u-1",
    text: "4 recesed lights + City of Austin permit",
  });
  assertEquals(res.lines, ["4 recesed lights", "City of Austin permit"]);
});

Deno.test("REQ-443 m46 professionalize: '(trench + patch)' stays one line through the model and the fallback", async () => {
  const text = "New drain line thru slab to island (trench + patch)";
  // The model answers one line — that is faithful, not a fold of two items.
  const { llm, flow } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      lines: [
        "Install new drain line through slab to island (trench and patch)",
      ],
    }),
  }));
  const res = await flow.run({ userId: "u-1", text });
  assertEquals(res.lines, [
    "Install new drain line through slab to island (trench and patch)",
  ]);
  // The stub / offline fallback keeps the parenthetical whole.
  const off = await fresh().flow.run({ userId: "u-1", text });
  assertEquals(off.lines, [text]);
});

/**
 * REQ-675 (demo-loop cycle 5, p18-7b): "'Polish this line?' makes the text
 * worse" — "…white subway tile with dark grout" came back as "…white subway
 * tile dark grout". A reply that only deletes words of the line is not a
 * polish: the coordinator hands back the line as written (so no offer is
 * made), and the prompt tells the model to keep meaningful prepositions and
 * articles and never compress an already-clear line.
 */
Deno.test("REQ-675 p18-7b professionalize: a deletion-only reply returns the line unchanged", async () => {
  const { llm, flow } = fresh();
  const text =
    "Install kitchen backsplash, 30 sq ft white subway tile with dark grout";
  llm.setHandler(() => ({
    text: JSON.stringify({
      lines: [
        "Install kitchen backsplash 30 sq ft white subway tile dark grout",
      ],
    }),
  }));
  const res = await flow.run({ userId: "u-1", text });
  assertEquals(res.lines, [text]);
  assertEquals(res.text, text);
});

Deno.test("REQ-675 p18-7b professionalize: a reply that changes words is still returned", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({ lines: ["Install backsplash with grout"] }),
  }));
  const res = await flow.run({
    userId: "u-1",
    text: "instal backsplash w/ grout",
  });
  assertEquals(res.lines, ["Install backsplash with grout"]);
});

Deno.test("REQ-675 p18-7b professionalize: the prompt keeps meaningful prepositions and never compresses a clear line", async () => {
  const { llm, flow } = fresh();
  let prompt = "";
  llm.setHandler((req) => {
    prompt = req.systemPrompt;
    return { text: JSON.stringify({ lines: ["Repair of the gate"] }) };
  });
  await flow.run({ userId: "u-1", text: "fix the gate" });
  assert(
    /prepositions and articles/i.test(prompt),
    "keeps prepositions/articles",
  );
  assert(/never compress/i.test(prompt), "never compresses a clear line");
});

/**
 * REQ-751 (demo-loop cycle 5v1, p18-7b re-test): REQ-675 only judged a
 * SINGLE-line reply. The verifier still saw "…subway tile with dark grout" →
 * "Install kitchen backsplash 30 sq ft white subway tile dark grout" and
 * "Patch two holes in the drywall with joint compound and repaint the area" →
 * "Patch two holes in drywall Apply joint compound Repaint the area": the
 * model SPLIT a bullet with no "+"/"plus" into several lines (the offer shows
 * them one per line, read aloud as one run-on), dropping words on the way.
 * A bullet that names one item comes back as ONE line or as written.
 */
const REQ751_BACKSPLASH =
  "Install kitchen backsplash, 30 sq ft white subway tile with dark grout";
const REQ751_DRYWALL =
  "Patch two holes in the drywall with joint compound and repaint the area";

Deno.test("REQ-751 p18-7b professionalize: a split of the backsplash bullet (no '+') returns the line unchanged", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      lines: [
        "Install kitchen backsplash",
        "30 sq ft white subway tile dark grout",
      ],
    }),
  }));
  const res = await flow.run({ userId: "u-1", text: REQ751_BACKSPLASH });
  assertEquals(res.lines, [REQ751_BACKSPLASH]);
  assertEquals(res.text, REQ751_BACKSPLASH);
});

Deno.test("REQ-751 p18-7b professionalize: the drywall bullet split into three lines returns the line unchanged", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      lines: [
        "Patch two holes in drywall",
        "Apply joint compound",
        "Repaint the area",
      ],
    }),
  }));
  const res = await flow.run({ userId: "u-1", text: REQ751_DRYWALL });
  assertEquals(res.lines, [REQ751_DRYWALL]);
});

Deno.test("REQ-751 p18-7b professionalize: a one-line rewrite of a long bullet is still returned", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      lines: [
        "Patch two holes in the drywall with joint compound and repaint the patched area",
      ],
    }),
  }));
  const res = await flow.run({
    userId: "u-1",
    text: "patch 2 holes in the drywall w/ joint compound and repaint",
  });
  assertEquals(res.lines.length, 1);
});

Deno.test("REQ-751 p18-7b professionalize: the prompt keeps one bullet one line, whatever its length", async () => {
  const { llm, flow } = fresh();
  let prompt = "";
  llm.setHandler((req) => {
    prompt = req.systemPrompt;
    return { text: JSON.stringify({ lines: ["Repair of the gate"] }) };
  });
  await flow.run({ userId: "u-1", text: "fix the gate" });
  assert(
    /never split a bullet/i.test(prompt),
    "says never split a bullet without '+'/'plus'",
  );
  assert(
    !/roughly 3–8 words/.test(prompt),
    "no hard word budget that pushes a clear line to be cut or split",
  );
});
