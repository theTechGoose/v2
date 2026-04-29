# KPI grid (dashboard)

## What
Four metric cards under the hero. Data comes from a static `items` array in the React export.

## Data
| Icon | Tint | Label | Value | Sub | Delta |
|---|---|---|---|---|---|
| `ICN.hardhat` | green-50 / green-600 | Active jobs | `7` | `on the books` | up `▲ 2` |
| `ICN.invoice` | pink-50 / pink-700 | Outstanding | `$6,420` | `4 invoices` | warn `1 overdue` |
| `ICN.quote` | coffee-50 / coffee-600 | Quotes pending | `4` | `$12.8k in flight` | neutral `2 viewed` |
| `ICN.trend` | teal-50 / teal-600 | Avg. job size | `$2,830` | `last 30 days` | up `▲ 8%` |

The icon `background` and `color` are set inline per item using token vars.

## Component
See `shared/kpi-card/` for the full HTML/CSS pattern.

## Source
`pages/dashboard/raw.html` lines 2431–2455.
