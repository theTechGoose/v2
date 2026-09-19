# Repro — "this is I from help me price it" as the sender name

## Steps (brand-new account, first message = the chip text)
1. `deno task serve`. Log in with a phone that has never been used (e.g. `+15125550996`, code `000000`).
2. On `/assistant` (first turn of a fresh account) type exactly `I know the job, help me price it.` into the composer and send — or click that chip if the first turn goes through the same path.
3. Open `/settings`.
4. **Expected:** your name is still the placeholder. **Actual:** name = "I know the job", business = "help me price it". Every quote email/SMS now says "this is I from help me price it".

## Trace it by hand
`backend/src/agents/domain/business/onboarding/mod.ts:131-187`: ≤80 chars ✓ · `QUOTE_SIGNAL_RE` has no "price" ✓ · 8 words ✓ · `PREFIX_RE` does not match "I know" ✓ · `SEPARATOR_RE` splits on ", " → name "I know the job", business "help me price it".
`backend/src/agents/domain/coordinators/handle-chat-message/mod.ts:230` calls it on the first turn with no `looksLikeJobRequest` guard (its sibling at `:267` has one).

## Red tests
- `cd backend && deno test -A --unstable-kv src/agents/domain/business/onboarding/test.ts` (new) — `extractNameAndBusiness("I know the job, help me price it.")` must be `undefined`.
- `handle-chat-message/int.test.ts` first-turn case.
