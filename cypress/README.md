# Cypress e2e harness

End-to-end tests for the v2 contractor app. Lives outside the Deno workspace so
Cypress's npm-native install path doesn't conflict with `nodeModulesDir=manual`
in the root `deno.json`.

## Setup

```sh
cd cypress
npm install
```

## Run against the local dev server

In one terminal:

```sh
# repo root
deno task serve   # backend :3000, frontend :5173
```

In another:

```sh
cd cypress
npm run open      # interactive runner
# or
npm run run       # headless (CI)
```

## Layout

- `e2e/` — one spec per feature area. File names follow `<feature>-<flow>.cy.ts`.
- `support/` — shared commands (`cy.loginAs`, `cy.apiCreateInvoice`, etc.).
- `fixtures/` — JSON request bodies and snapshot payloads.

## Pointing at staging/prod

```sh
CYPRESS_BASE_URL=https://staging.paperworkmonsters.com npm run run
```
