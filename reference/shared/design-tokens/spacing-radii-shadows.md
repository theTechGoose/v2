# Spacing, radii, shadows, layout

Source: `extracted/colors_and_type.css` lines 135–173.

## Spacing scale (8pt soft grid)

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 24px |
| `--space-6` | 32px |
| `--space-7` | 48px |
| `--space-8` | 64px |
| `--space-9` | 96px |

## Border radii

| Token | Value | Typical use |
|---|---|---|
| `--radius-sm` | 8px | Inline pills, small chips |
| `--radius-md` | 12px | Inputs, small buttons |
| `--radius-lg` | 16px | Cards, panels |
| `--radius-xl` | 24px | Hero panels, large cards |
| `--radius-2xl` | 32px | Wrapper containers |
| `--radius-pill` | 999px | CTA buttons, badges |

## Shadows (warm coffee-tinted)

| Token | Value |
|---|---|
| `--shadow-sm` | `0 1px 2px rgba(100, 69, 54, 0.06), 0 1px 3px rgba(100, 69, 54, 0.04)` |
| `--shadow-md` | `0 4px 8px rgba(100, 69, 54, 0.08), 0 2px 4px rgba(100, 69, 54, 0.04)` |
| `--shadow-lg` | `0 12px 24px rgba(100, 69, 54, 0.10), 0 4px 8px rgba(100, 69, 54, 0.06)` |
| `--shadow-xl` | `0 24px 48px rgba(100, 69, 54, 0.12), 0 8px 16px rgba(100, 69, 54, 0.06)` |
| `--shadow-focus` | `0 0 0 4px rgba(81, 152, 67, 0.24)` |

## Layout

| Token | Value | Use |
|---|---|---|
| `--container-marketing` | 1200px | Landing page max-width |
| `--container-product` | 1280px | Dashboard max-width |
| `--sidebar-w` | 240px | Dashboard sidebar |

## Reduced motion

Globally honored via:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```
