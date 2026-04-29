# Animations — hero-phone-mockup

Five keyframes drive this scene; full definitions in `shared/design-tokens/motion.md`.

| Keyframe | Selector | Duration / behavior |
|---|---|---|
| `phoneFloat` | `.hs-phone` | 6s ease-in-out infinite. Translate Y while preserving rotate(-3deg). |
| `blobDrift` | `.hs-blob` | 14–16s ease-in-out infinite. The `--pink` blob runs `-4s reverse` for offset. |
| `docFloat` | `.hs-doc` | 6s ease-in-out -3s infinite (offset start). |
| `badgeFloat` | `.hs-badge` | 5s ease-in-out -2s infinite. |
| `twinkle` | `.spark.s1` / `.s2` / `.s3` | 3s ease-in-out infinite, staggered delays (0s / 1s / 1.6s). |

```css
.hs-phone   { animation: phoneFloat 6s ease-in-out infinite; }
.hs-blob--mint { animation: blobDrift 14s ease-in-out infinite; }
.hs-blob--pink { animation: blobDrift 16s ease-in-out -4s infinite reverse; }
.hs-doc     { animation: docFloat 6s ease-in-out -3s infinite; }
.hs-badge   { animation: badgeFloat 5s ease-in-out -2s infinite; }
```
