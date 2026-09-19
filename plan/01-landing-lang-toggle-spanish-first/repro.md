# Repro — the English button renders first on the landing toggle

## Steps
1. `deno task serve` at the repo root. Open a private window (no `pm_lang` cookie) at `http://localhost:5280/`.
2. Look at the language toggle in the header.
3. **Expected:** "Yo hablo Español | I speak English", Spanish on the left and highlighted.
   **Actual:** "I speak English | Yo hablo Español" — Spanish IS highlighted (default is already es), but it sits on the right.
4. Compare `http://localhost:5280/landing` — that page already puts Spanish first.

## Confirm in code
```
sed -n 290,309p front-end/routes/index.tsx     # data-lang="en" button is the first child
sed -n 119,132p front-end/routes/landing.tsx   # ES first here
```

## Red test
`cd cypress && npx cypress run --spec e2e/landing-lang-toggle.cy.ts` (new file from the plan) → first `.lang-toggle button` has `data-lang="en"`.
