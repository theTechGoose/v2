// REQ-428 — demo-loop cycle 2, issues nc-pair-numbering + nc-pair6-report.
// Runs the real demo20b.sh with its setup skipped and a fake fleet-claude on the PATH
// (demo-loop/testdata/fleet-claude), so the harness's own numbering, timeout and report
// fallback are exercised end to end.
import assert from "node:assert/strict";

const assertEquals = (a: unknown, b: unknown, msg?: string) =>
  assert.deepEqual(a, b, msg);
const assertMatch = (s: string, re: RegExp, msg?: string) =>
  assert.match(s, re, msg);
const assertStringIncludes = (s: string, sub: string) =>
  assert.ok(
    s.includes(sub),
    `expected to contain ${JSON.stringify(sub)}:
${s}`,
  );

const here = new URL(".", import.meta.url).pathname;
const script = `${here}demo20b.sh`;

async function runHarness(
  env: Record<string, string>,
): Promise<{ out: string; work: string; code: number }> {
  const work = await Deno.makeTempDir({ prefix: "demo20b-" });
  const v2 = await Deno.makeTempDir({ prefix: "demo20b-v2-" });
  const git = (...args: string[]) =>
    new Deno.Command("git", { args, cwd: v2, stdout: "null", stderr: "null" })
      .output();
  await git("init", "-q");
  await git(
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "x",
  );
  await Deno.writeTextFile(`${work}/serve.log`, "");
  const { stdout, code } = await new Deno.Command("bash", {
    args: [script],
    env: {
      PATH: `${here}testdata:${Deno.env.get("PATH")}`,
      DEMO_IDX: "5",
      DEMO_WORK: work,
      DEMO_V2: v2,
      DEMO_SERVE_LOG: `${work}/serve.log`,
      DEMO_SKIP_SETUP: "1",
      DEMO_STAGGER: "0",
      DEMO_AGENT_SECS: "30",
      DEMO_KILL_GRACE: "2",
      ...env,
    },
    stdout: "piped",
    stderr: "inherit",
  }).output();
  return { out: new TextDecoder().decode(stdout), work, code };
}

function section(out: string, who: string): string {
  const start = out.indexOf(`PAIR 6 ${who} REPORT`);
  assert(start >= 0, `no ${who} section in:\n${out}`);
  const end = out.indexOf("################", out.indexOf("\n", start));
  return out.slice(start, end < 0 ? undefined : end);
}

Deno.test("REQ-428 (nc-pair-numbering): every status line names the same pair number as the persona header", async () => {
  const { out } = await runHarness({ FAKE_DEMOER: "ok", FAKE_CUSTOMER: "ok" });
  const tags = [...out.matchAll(/^\[[^\]]*\]/gm)].map((m) => m[0]);
  assertEquals(tags.length, 3, out);
  for (const t of tags) assertMatch(t, /\bpair 6\]$/, `status line tag ${t}`);
  assertStringIncludes(out, "PAIR 6 · CUSTOMER: Luis Ortega");
  assert(
    !/\[pair 5\]/.test(out),
    "a status line still prints the 0-based VM index as the pair",
  );
});

Deno.test("REQ-428 (nc-pair6-report): agents run with a stream-json transcript", async () => {
  const { work } = await runHarness({ FAKE_DEMOER: "ok", FAKE_CUSTOMER: "ok" });
  for (const who of ["demoer", "customer"]) {
    const args = (await Deno.readTextFile(`${work}/${who}.args`)).split("\n");
    const i = args.indexOf("--output-format");
    assert(
      i >= 0 && args[i + 1] === "stream-json",
      `${who} args: ${args.join(" ")}`,
    );
    assert(
      args.includes("--verbose"),
      `${who}: claude -p needs --verbose with stream-json`,
    );
  }
});

Deno.test("REQ-428 (nc-pair6-report): an agent that ends without a report file still shows its final message, not raw JSON", async () => {
  const { out } = await runHarness({
    FAKE_DEMOER: "ok",
    FAKE_CUSTOMER: "ok-noreport",
  });
  const c = section(out, "customer");
  assertStringIncludes(c, "FINAL REPORT TEXT of customer");
  assert(
    !c.includes('{"type":'),
    `raw stream-json leaked into the report:\n${c}`,
  );
  assertStringIncludes(section(out, "demoer"), "# demoer REPORT FROM FILE");
});

Deno.test("REQ-428 (nc-pair6-report): a timed-out agent gets SIGTERM early, is marked killed by timeout, and leaves its trace and full stderr", async () => {
  const t0 = Date.now();
  const { out, work } = await runHarness({
    FAKE_DEMOER: "ok",
    FAKE_CUSTOMER: "hang",
    DEMO_AGENT_SECS: "4",
    DEMO_KILL_GRACE: "2",
  });
  const secs = (Date.now() - t0) / 1000;
  assert(
    secs < 4.8,
    `the harness waited ${secs}s — SIGTERM must come DEMO_KILL_GRACE before the hard timeout`,
  );
  assertEquals(
    (await Deno.readTextFile(`${work}/customer.signal`)).trim(),
    "TERM",
  );
  const c = section(out, "customer");
  assertStringIncludes(c, "killed by timeout");
  assertStringIncludes(c, "checking the quotes page as customer");
  for (const n of [1, 2, 3]) assertStringIncludes(c, `stderr line ${n}`);
  assert(!section(out, "demoer").includes("killed by timeout"));
});

Deno.test("REQ-428 (nc-pair6-report, S3): the prompts ask for a draft report at minute 10 and name the presenter just Alex", async () => {
  const { work } = await runHarness({ FAKE_DEMOER: "ok", FAKE_CUSTOMER: "ok" });
  for (const who of ["demoer", "customer"]) {
    const p = await Deno.readTextFile(`${work}/${who}.txt`);
    assertMatch(p, /minute 10[^.]*draft[^.]*report/i, `${who} prompt`);
    assertStringIncludes(p, `${work}/${who}-report.md`);
  }
  const d = await Deno.readTextFile(`${work}/demoer.txt`);
  assertStringIncludes(d, 'the name "Alex"');
  assert(!d.includes("Alex from DocuMonster"));
});

Deno.test("REQ-533: both agents are told that a headless tab switch is not a real one — click in the tab after switching", async () => {
  const { work } = await runHarness({ FAKE_DEMOER: "ok", FAKE_CUSTOMER: "ok" });
  for (const who of ["demoer", "customer"]) {
    const p = await Deno.readTextFile(`${work}/${who}.txt`);
    assertMatch(p, /switch(ing)? (to )?(another|a different|an older) tab[^.]*click/i, `${who} prompt`);
    assertMatch(p, /headless/i, `${who} prompt names why`);
  }
});

// REQ-621 — one rule for what is a real issue, used by the testers and by the judge.
const RULES = `${here}ISSUE-RULES.md`;
const CATEGORIES = ["NOT_REAL", "BUG_CONTRADICTION", "BUG_HARM", "MISSING_IN_FLOW", "MISSING_NEW_AREA", "BUG_POLISH", "OWNER_CALL", "NITPICK", "PEDANTIC"];

Deno.test("REQ-621: the rules file names every category, in the order they are checked, each with an action", async () => {
  const r = await Deno.readTextFile(RULES);
  let at = -1;
  for (const c of CATEGORIES) {
    const i = r.indexOf(`${c}`);
    assert(i > at, `${c} missing or out of order`);
    at = i;
  }
  assertMatch(r, /first (one that )?(matches|yes) wins/i);
  for (const action of ["fix", "owner list", "log", "drop"]) assertMatch(r, new RegExp(action, "i"));
  // nothing a user would notice can be a nitpick: polish is checked before nitpick
  assert(r.indexOf("BUG_POLISH") < r.indexOf("NITPICK"));
});

Deno.test("REQ-621: both testers are told to read the rules and tag every issue with its category", async () => {
  const { work } = await runHarness({ FAKE_DEMOER: "ok", FAKE_CUSTOMER: "ok" });
  for (const who of ["demoer", "customer"]) {
    const p = await Deno.readTextFile(`${work}/${who}.txt`);
    assertStringIncludes(p, "demo-loop/ISSUE-RULES.md");
    assertMatch(p, /category/i, `${who} prompt asks for a category`);
    assertMatch(p, /NITPICK|PEDANTIC/, `${who} prompt says low categories are still reported`);
  }
});
