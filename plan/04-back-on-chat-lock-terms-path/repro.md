# Repro — back exits to the dashboard on the chat → "Lock it in" → terms path

## Needs a real LLM key (the action card comes from the model)
1. Put `OPENAI_API_KEY=…` in `.env` at the repo root; `deno task serve`; log in.
2. `/assistant` → do NOT click a chip; type in the composer: `Replace a toilet for $500 for Sam Rivera` → send.
3. The assistant answers with an action card that has "Lock it in". Click it → a "Ready to send" CTA appears → the wizard's customer question opens.
4. Click the header back arrow.
5. **Expected:** the action card / chat is visible again. **Actual:** `/dashboard`.

## Why (read these in order)
```
sed -n 1746,1778p front-end/islands/AsstChat.tsx   # sendText → submitTurn: no pushHistory()
sed -n 3013,3032p front-end/islands/AsstChat.tsx   # lockActionCard: no pushHistory()
sed -n 2600,2634p front-end/islands/AsstChat.tsx   # submitContinueCta terms branch: no pushHistory()
sed -n 1104,1110p front-end/islands/AsstChat.tsx   # popHistory exits when the snapshot has no wizard step and no panel
sed -n 76,79p backend/src/agents/domain/coordinators/rewind-wizard/mod.ts   # server rewind clamps at step 0; cannot leave the terms phase
```

## Red test (deterministic, no LLM)
`cd backend && deno test -A --unstable-kv src/agents/domain/coordinators/rewind-wizard/int.test.ts` with the `toStepIdx: -1` case from the plan.
