# Daily summary — "What we handled today"

## What
Activity feed panel sitting in the bottom-left of the dashboard grid. Shows what the back-end automation ("the monsters") did on the user's behalf during the day.

## Composition
- `shared/panel/` shell with title "What we handled today" + sub-line "The monsters have been busy" + "Full log →" action.
- Body: 4 `shared/activity-item` rows, separated by dashed coffee dividers.

## Data (from ACTIVITY array)
| Icon | Tint | Text | Time |
|---|---|---|---|
| `ICN.check` | green | **Tom & Linda K.** opened your quote for the second time | 2 min ago |
| `ICN.send` | pink | You texted us "new job — paint kitchen for Marcus Lin". **Quote drafted.** | 1 hr ago |
| `ICN.card` | green | **Cobblestone Cafe** paid invoice #INV-198 — $1,000 deposit | 3 hr ago |
| `ICN.contract` | teal | **Sarah Chen** e-signed the bathroom remodel contract | Yesterday |

## Source
`pages/dashboard/raw.html` lines 2587–2616.
