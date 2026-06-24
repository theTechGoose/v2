import type { ComponentChildren } from "preact";

interface Props {
  eyebrow?: string;
  title: string;
  lede?: ComponentChildren;
}

export function SectionHead({ eyebrow, title, lede }: Props) {
  return (
    <div class="section-head">
      {eyebrow ? <span class="eyebrow-pill">{eyebrow}</span> : null}
      <h2>{title}</h2>
      {lede ? <p class="lede">{lede}</p> : null}
    </div>
  );
}
