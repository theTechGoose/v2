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
deno task serve   # backend :4280, frontend :5280
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
- `support/` — shared commands (`cy.loginAs`, `cy.apiCreateQuote`, etc.).
- `fixtures/` — JSON request bodies and snapshot payloads.

## Pointing at staging/prod

```sh
CYPRESS_BASE_URL=https://staging.paperworkmonster.com npm run run
```

## Step-through mode

Specs call `cy.step("…")` between major user actions. By default it's a
no-op so tests run full-speed in CI. Set `CYPRESS_STEP=1` to pause at every
step — the runner shows a Resume / Next button so you can walk one step at
a time:

```sh
CYPRESS_STEP=1 npm run open
```

Without the env var, the same spec runs straight through.

**Hotkeys while paused** (work regardless of which iframe has focus, so the
app under test can't swallow them):

- **F9** — Resume (run until the next `cy.step()` / end)
- **F10** — Next command (advance one Cypress command)

## Per-feature runs

```sh
npm run run:auth        # auth + landing
npm run run:dashboard   # dashboard pages
npm run run:assistant   # assistant / chat
npm run run:quotes      # quotes pipeline
npm run run:public      # customer-facing public pages
npm run run:clients     # clients page
npm run run:invoice     # invoice flows
npm run run:e2e-funnel  # full quote-to-cash funnel
```
