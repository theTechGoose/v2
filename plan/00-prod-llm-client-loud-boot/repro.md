# Repro — is production (or this box) running the stub LLM?

## What you are proving
`backend/src/agents/mod-root.ts:53-61` silently picks `StubLLMClient` unless the env var `AGENTS_LLM_CLIENT` is exactly `openai`.
The stub answers `"(stub) <your text>"`, which is not JSON, so every job-options / price call falls to the deterministic fallbacks.

## Repro A — on this box (deterministic, 2 minutes)
1. From the repo root start the backend WITHOUT the var (do not use `deno task serve`, which sets it):
   `cd backend && PORT=4280 deno run -A --unstable-kv bootstrap/mod.ts`
2. In a second terminal log in with the master OTP and call the options endpoint:
   ```
   curl -s -c c.txt -X POST localhost:4280/auth/verify -H 'content-type: application/json' -d '{"phoneNumber":"+15125550999","code":"000000"}'
   curl -s -b c.txt -X POST localhost:4280/agents/job-details/options -H 'content-type: application/json' -d '{"raw":"I need to replace a toile for $500"}'
   ```
3. **Actual:** three options whose `bullets` are the sentence verbatim, `jobName` "I Need To", third option adds "Jobsite cleanup".
   This is byte-for-byte the client's p4 screenshot.
4. Repeat with `AGENTS_LLM_CLIENT=openai OPENAI_API_KEY=<key>` in front of the `deno run` → rewritten scope bullets.

## Repro B — production
1. Open the hosting dashboard (Deno Deploy assumed — `mod.ts:6` talks about Deploy) → project → Settings → Environment variables.
2. Confirm presence of `AGENTS_LLM_CLIENT=openai`, `OPENAI_API_KEY`, `TRANSCRIPTION_CLIENT=openai`.
3. If absent, that is the bug. If present, run the toilet sentence in prod and read the deploy logs for `[suggest-prices] llm call failed` / `[generate-job-options] llm call failed`.

## Confirm in code
```
sed -n 53,61p backend/src/agents/mod-root.ts        # the silent fall-through
sed -n 43,44p backend/src/agents/domain/business/llm/implementations/stub/mod.ts   # the "(stub)" echo
grep -rn "AGENTS_LLM_CLIENT" serve.ts backend/deno.json deno.json                  # only dev sets it; root deno.json does not
```

## Red test that pins the fix
`cd backend && deno test -A --unstable-kv src/agents/domain/business/llm/select/test.ts` → "module not found" until `select/mod.ts` exists.
