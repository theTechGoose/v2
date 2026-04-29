# Greeting hero (dashboard)

## What
The dashboard's specific instance of `shared/hero-banner`. Renders the user's name + earned-this-month total in a Ticker, plus a subtitle nudging them toward the Assistant page.

## Markup template (extracted from raw.html lines 2399–2427)

```html
<section class="hero">
  <div class="hero__copy">
    <h1 class="hero__title">
      You've billed <em>$18,420</em> this month.<br/>
      Let's get those quotes out the door.
    </h1>
    <p class="hero__sub">
      4 quotes are sitting with clients. Send a nudge, or fire off a fresh one straight from a text.
    </p>
    <div class="hero__stats">
      <span class="hero__stat"><strong>▲ 24%</strong> vs March</span>
      <span class="hero__stat"><strong>$4,180</strong> ahead of last month</span>
      <span class="hero__stat hero__stat--pink"><strong>4 quotes</strong> awaiting signature</span>
    </div>
    <div class="hero__cta-row" style="margin-top:18px;">
      <a class="btn btn--quote" href="Paperwork Monsters Assistant.html">My assistant</a>
    </div>
  </div>
  <div class="hero__art">
    <span class="hero__confetti hero__confetti--1"></span>
    <span class="hero__confetti hero__confetti--2"></span>
    <span class="hero__confetti hero__confetti--3"></span>
    <div class="hero__art-blob"></div>
    <img class="hero__monster" src="…logo…" alt="" />
  </div>
</section>
```

## Data
- `Ticker` value: `18420`.
- Stats line: `▲ 24% vs March`, `$4,180 ahead of last month`, `4 quotes awaiting signature` (pink variant).
- CTA: pink-green primary button "My assistant" linking to the Assistant page.

## Shared component
See `shared/hero-banner/` for the full styles, layout, animations (`hbob`, `ppulse`).

## Source
`pages/dashboard/raw.html` lines 2399–2427.
