/**
 * REQ-617 (demo-loop cycle 4, demo p4-p3a): a TERMS value on the "Ready to
 * send" review card with its edit pencil. The pencil is a real <Icon> held in
 * a `white-space: nowrap` span together with the value's last word, so it can
 * never wrap onto a line of its own (the old free CSS `::after` pencil did).
 */
import { Icon } from "./ui/Icon.tsx";

/** Split a value into [everything before the last word, the last word]. */
export function splitLastWord(value: string): [string, string] {
  const m = value.match(/^([\s\S]*?)(\S+)\s*$/);
  return m ? [m[1], m[2]] : [value, ""];
}

export function TermEditValue({ value }: { value: string }) {
  const [head, last] = splitLastWord(value);
  return (
    <>
      {head}
      <span class="quote-review__term-tail">
        {last}
        <Icon name="pencil" size={13} class="quote-review__term-pencil" />
      </span>
    </>
  );
}
