# `Footer` — Landing footer

## Purpose

Thin footer below the contact section. Brand mark on the left, three navigation links centered, copyright on the right. Single border-top divider, no background.

## Source

- HTML: `Paperwork Monsters Landing.html` lines **2462–2475**
- CSS: `styles.css` lines **1144–1154**

## HTML (verbatim)

```html
<footer class="footer">
  <div class="container footer-row">
    <a href="#" class="brand">
      <img src="/logo-monster.png" alt=""/>
      <span>Paperwork</span><em style="font-style:normal;color:var(--brand-green)">Monsters</em>
    </a>
    <div class="links">
      <a href="#features"     data-i18n="nav.features">What We Do</a>
      <a href="#how-it-works" data-i18n="nav.how">How It Works</a>
      <a href="#pricing"      data-i18n="nav.pricing">Pricing</a>
      <a href="#contact"      data-i18n="footer.contact">Contact</a>
    </div>
    <div class="copy" data-i18n="footer.copy">© 2026 Paperwork Monsters. All rights reserved.</div>
  </div>
</footer>
```

## CSS (verbatim)

```css
.footer {
  padding: 48px 0 32px;
  border-top: 1px solid var(--border);
}
.footer-row {
  display: flex; justify-content: space-between; align-items: center;
  flex-wrap: wrap; gap: 16px;
}
.footer-row .copy        { font-size: 13px; color: var(--fg-muted); }
.footer-row .links       { display: flex; gap: 24px; font-size: 13px; color: var(--fg-muted); }
.footer-row .links a:hover { color: var(--brand-pink); }
```

## Preact / Fresh translation

```tsx
// v2/frontend/components/landing/Footer.tsx — server component

import { langSignal } from "../../lib/lang-signal.ts";

const T = (lang: 'en'|'es') => lang === 'es' ? {
  features: 'Qué hacemos', how: 'Cómo funciona', pricing: 'Precios', contact: 'Contacto',
  copy: '© 2026 Paperwork Monsters. Todos los derechos reservados.',
} : {
  features: 'What We Do', how: 'How It Works', pricing: 'Pricing', contact: 'Contact',
  copy: '© 2026 Paperwork Monsters. All rights reserved.',
};

export function Footer() {
  const t = T(langSignal.value);
  return (
    <footer class="pt-12 pb-8 border-t border-coffee-500/16">
      <div class="container mx-auto max-w-[1200px] px-[clamp(20px,5vw,56px)]
                  flex justify-between items-center flex-wrap gap-4">
        <a href="#" class="flex items-center gap-2.5 font-heading font-extrabold text-[19px] text-teal-500 -tracking-[0.02em] shrink-0">
          <img src="/logo-monster.png" alt="" width={38} height={38} class="block" />
          <span>Paperwork<em class="not-italic text-green-500">Monsters</em></span>
        </a>
        <div class="flex gap-6 text-[13px] text-teal-500/72">
          <a href="#features"     class="hover:text-pink-500">{t.features}</a>
          <a href="#how-it-works" class="hover:text-pink-500">{t.how}</a>
          <a href="#pricing"      class="hover:text-pink-500">{t.pricing}</a>
          <a href="#contact"      class="hover:text-pink-500">{t.contact}</a>
        </div>
        <div class="text-[13px] text-teal-500/72">{t.copy}</div>
      </div>
    </footer>
  );
}
```

## Props

```ts
type FooterProps = {};
```

## Data source

Static.

## Island vs server

**Server.** No JS.

## Accessibility

- Use `<footer role="contentinfo">` (the role is implicit on `<footer>` when it's a direct child of `<body>` — verify Fresh's `_app.tsx` doesn't wrap it in another `<main>` or `<article>`).
- Brand link `<a href="#">` on a footer is a "back to top" link by convention — make it `<a href="#" aria-label="Back to top">` or change to `<a href="/">`.
- Copyright text is decorative; no aria needed.

## Edge cases

- **Below 980px:** flex-wrap is already on; the three pieces stack vertically with `gap: 16px`.
- **Long ES copy:** "Todos los derechos reservados" is comparable in length to EN; no overflow.
- **Year update:** the copyright says `© 2026` literally — do not auto-`new Date().getFullYear()` it; the marketing team owns the value.
