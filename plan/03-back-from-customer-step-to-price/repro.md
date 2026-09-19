# Repro — back at the customer step (as reported on p31)

## Steps
1. `deno task serve`; log in; `/assistant` → "I know my price, write it up." → type details → send → price `500` → Continue.
2. You are now on the wizard's first question (customer) at `/assistant/<threadId>`.
3. Click the single header back arrow (`a.chat__head-btn`).
4. **Client's report:** lands on `/dashboard`. **Today on this tree:** returns to the price step — commit `4a1457a` fixed this path
   (`front-end/islands/AsstChat.tsx:2181-2185` pushes a snapshot before the navigation). Nothing pins it, which is why the task exists.
5. To see the *unfixed* behaviour: `git stash` is forbidden here — instead read `git show 4a1457a --stat` and `git show 4a1457a -- front-end/islands/AsstChat.tsx | head -80`.

## Confirm in code
```
sed -n 45,54p shared/quote-flow/assistant-back.ts     # step 0 + empty stack → "exit-dashboard"
sed -n 2179,2185p front-end/islands/AsstChat.tsx       # the snapshot that prevents it on the price path
```

## Test to add (green on arrival — a regression pin)
`cd cypress && npx cypress run --spec e2e/ux-assistant-single-back.cy.ts` with the third `it` from the plan.
