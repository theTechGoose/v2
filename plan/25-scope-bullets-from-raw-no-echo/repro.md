# Repro — the fallback echoes the contractor's sentence

## Deterministic, no browser
1. Start the backend without a key (see folder 00, Repro A) and log in with curl.
2. `curl -s -b c.txt -X POST localhost:4280/agents/job-details/options -H 'content-type: application/json' -d '{"raw":"I need to replace a toile for $500"}'`
3. **Actual:** `opt1.bullets = ["I need to replace a toile for $500"]`, `opt2` identical, `opt3` adds "Jobsite cleanup"; `jobName` "I Need To" (+ "· Short version" / "· Wider scope").
4. `curl … /agents/job-details/polish -d '{"raw":"I need to replace a toile for $500"}'` → `description` is the raw sentence.
5. With a real key, kill the network mid-call (or set `OPENAI_API_KEY=bad`) → same output: the catch path takes the same fallback.

## Confirm in code
```
sed -n 236,272p backend/src/agents/domain/coordinators/generate-job-options/mod.ts   # fallbackOptions: bullets = raw sentences
sed -n 212,220p backend/src/agents/domain/coordinators/generate-job-options/mod.ts   # clampJobName → "I Need To"
sed -n 152,161p backend/src/agents/domain/coordinators/polish-job-details/mod.ts     # description: raw
sed -n 118,126p backend/src/agents/domain/coordinators/generate-job-options/mod.ts   # both the catch and the unparseable path land there
```

## Red tests
- `cd jest && npx jest unit/scope-from-raw.test.ts` (module does not exist).
- `cd backend && deno test -A --unstable-kv src/agents/domain/coordinators/generate-job-options/int.test.ts` (new).
