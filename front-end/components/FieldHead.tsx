/** REQ-143 — the field pages' header: eyebrow, a title with one <em> run in brand pink, a sub-line, actions. */
import type { ComponentChildren } from "preact";
import { splitEm } from "../lib/field.ts";

interface Props {
  eyebrow: string;
  /** may contain one `<em>…</em>` run (the lang files do) */
  title: string;
  sub?: string;
  children?: ComponentChildren;
}

export default function FieldHead({ eyebrow, title, sub, children }: Props) {
  const em = splitEm(title);
  return (
    <div class="field-head">
      <div>
        <div class="field-eyebrow">{eyebrow}</div>
        <h1>
          {em
            ? (
              <>
                {em.before}
                <em>{em.em}</em>
                {em.after}
              </>
            )
            : title}
        </h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div class="field-actions">{children}</div>}
    </div>
  );
}
