# Repro — the "Confirm your job details" screen paints the raw text before the model answers

## Steps
1. `OPENAI_API_KEY` in `.env`; `deno task serve`; log in; open DevTools → Network → throttle to "Slow 3G".
2. `/assistant` → "I know the job, help me price it." → type `I need to replace a toilet for $500` → send.
3. **Actual:** the three cards appear instantly with the sentence verbatim ("· Short version" / "· Wider scope"); the "Writing up your options…" dots never show; a second or two later the cards silently swap to the model's text — unless you touched a bullet, in which case the echo stays.
4. Now block `POST /api/agents/job-details/options` in DevTools (Request blocking) and repeat → the echo stays forever, no error, no hint to write it yourself.

## Confirm in code
```
sed -n 1933,1942p front-end/islands/AsstChat.tsx   # setOptionsLoading(false) then paint localFallbackOptions BEFORE the await
sed -n 1950p front-end/islands/AsstChat.tsx         # swap only if !optionsTouchedRef.current
sed -n 3896,3906p front-end/islands/AsstChat.tsx   # the spinner branch that never renders
sed -n 219,222p front-end/islands/AsstChat.tsx     # the comment claiming it "only fires when the request never completed" — false
```

## Red test
`cd cypress && npx cypress run --spec e2e/ux-help-me-price.cy.ts` after adding the `cy.intercept` (delay → `.chat__jobopts-loading` visible; 500 → `[data-cy=jobopts-degraded]`).
