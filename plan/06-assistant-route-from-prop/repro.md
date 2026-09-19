# Repro — the From block is missing when the conversation started at /assistant

## Steps
1. `deno task serve`; log in as a contractor who has a business name, name, phone AND email in Settings.
2. Start at `http://localhost:5280/assistant` (the bare route, not a thread URL) → "I know my price, write it up." → details → price → wizard → review card.
3. **Expected:** a "From" block with business, name, phone, email. **Actual:** no From block at all.
4. Now open the same conversation from the threads list (`/assistant/<threadId>`) → the From block renders.

## Confirm in code
```
sed -n 97,104p front-end/routes/assistant/index.tsx        # <AsstChat> has no from={…}
sed -n 142,158p 'front-end/routes/assistant/[threadId].tsx'  # the sibling passes from={{business,name,phone,email}}
sed -n 5571,5572p front-end/islands/AsstChat.tsx            # the guard that hides the whole block when from is undefined
```

## Red test
`cd cypress && npx cypress run --spec e2e/ux-doc-preview.cy.ts` with the "started at /assistant shows the From block" case.
