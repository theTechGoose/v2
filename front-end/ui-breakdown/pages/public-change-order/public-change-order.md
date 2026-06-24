# Page: `/co/:id` — Public change order

**Route:** `routes/co/[id].tsx` · **Source copied to:** `js/[id].tsx`. Island in
`components/public-change-order-actions/`.

## Purpose
Customer-facing document for a contract **change order** (scope/price change),
opened from an SMS/email link. Customer reviews the delta and approves/declines.

## Classification & data flow
- **Page tier:** **SSR document** (`define.page` async) + one action island.
  No auth — a token-shaped `:id` link.
- **Data (server):** `ssrBackendGet<ChangeOrderPublic>('/change-orders/:id/public')`.
  Shape: `{ id, description, deltaAmountCents, status: pending|approved|declined,
  currentAmount?, newAmount?, businessName?, commsLanguage?, decidedAt? }`.
  On `!ok` → renders an **error card** (link expired / not available).
- **Language:** `commsLanguage === "es" ? es : en` (contractor's outgoing-comms
  language). All copy via `tFor(lang, "changeOrderPublic.*")`.
- **Money:** local `money(cents)` helper (`$x,xxx.xx`); `deltaAmountCents` is
  **cents**; `currentAmount`/`newAmount` passed to `money()` as cents too.
- **Surface:** the **public inline-styled palette** (NOT Sabor tokens) — see
  `design-tokens.md` § Public surface. Local consts: `TEAL #144852`,
  `GREEN #519843`, `INK #1c2c30`, `MUTED #6b7a7e`, `LINE #e3e8e6`,
  `CREAM #fffdf7`, `BG #f7f6f1`, `PINK #FF6B6B`, `PINK_DARK #d94e4e`. System
  font stack. Loads `/landing.css` only for resets.

## `<Head>`
`<title>{changeOrderPublic.docTitle}</title>` · `<link href="/landing.css">`.

## Layout / composition order
```
div (BG #f7f6f1, min-h 100dvh, kb-inset aware padding)
  div max-width:560px
    !co → error card (white, heading + message)
    co  → article (CREAM, radius 24, pink-bordered, shadow)
            div  8px top bar  → linear-gradient(PINK → PINK_DARK)
            padding 32/36
              eyebrow  businessName (PINK_DARK, uppercase, tracked)
              h1   changeOrderPublic.heading  (TEAL, 28px, 900)
              p    changeOrderPublic.intro     (MUTED)
              section ("What's changing", white card):
                label  whatsChanging
                p      co.description
                breakdown (top-bordered):
                  currentTotal / previousTotal (when status==="approved")  → money(currentAmount)
                  added / credit  (sign by deltaAmountCents ≥ 0)           → ±money(|delta|)  (credit in GREEN)
                  newTotal / proposedTotal (when status==="declined")      → money(newAmount) (declined in MUTED, else GREEN)
              <PublicChangeOrderActions changeOrderId initialStatus lang />  ← ISLAND
```
Note the status-aware wording: approved shows "previous total", declined frames
the new total as a "proposed total" that never took effect.

## Components
| Component | Folder | Tier |
|---|---|---|
| `PublicChangeOrderActions` | `components/public-change-order-actions/` | island — approve/decline buttons → POST; confirms in place; `initialStatus` seeds the rendered state. |

## Data-shape hazard
The `/public` read is a composite join (change order → contract → invoice
snapshot) fanned out per customer link-load — flag for caching/point-read.

## Capture checklist (auth-free, but needs a valid token id)
- URL: `/co/<changeOrderId>` (real id; otherwise error card renders — itself a
  capturable state).
- Viewports: 390 + 640 (single-column, max-width 560). Light theme.
- States: pending (action buttons), approved, declined, expired/error, `es`.

## Build order
public palette primitives → `public-change-order-actions` island → this page.
