import { useEffect, useRef, useState } from "preact/hooks";
import { type AddressSuggestion, suggestAddresses } from "../lib/mapbox.ts";

/**
 * REQ-599 (demo-loop cycle 4, m30) — a one-line address input with the same
 * Mapbox street autocomplete the onboarding wizard's address step uses
 * (front-end/lib/mapbox.ts through the /api/geocode proxy). The typed text is
 * ALWAYS the first option, so an address Mapbox doesn't know stays enterable;
 * suggestions are a convenience, a failed lookup is just an empty list.
 * Picking a suggestion fills the input with its full label
 * ("1600 Congress Ave, Austin, TX 78701").
 *
 * Use it inside an island (it holds state).
 */
interface Props {
  value: string;
  onInput: (value: string) => void;
  lang: string;
  /** the field's accessible name (its visible label's text) */
  label: string;
  /** label of the "keep what I typed" option */
  useTypedLabel: string;
  /** id prefix for the listbox (aria-controls) */
  id: string;
  "data-cy"?: string;
  inputStyle?: string;
}

const LIST_STYLE =
  "position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:20;margin:0;padding:4px;list-style:none;background:#fff;border:1px solid var(--border,#d8dcd5);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.12);max-height:220px;overflow-y:auto";
const OPT_STYLE =
  "display:flex;align-items:baseline;justify-content:space-between;gap:10px;width:100%;text-align:left;font:inherit;font-size:14.5px;font-weight:400;color:var(--fg,#144852);background:transparent;border:0;border-radius:8px;padding:9px 10px;cursor:pointer";

export default function AddressAutocomplete(props: Props) {
  const { value, onInput, lang, useTypedLabel, id } = props;
  const [sugs, setSugs] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => {
    clearTimeout(timer.current);
    abort.current?.abort();
  }, []);

  function close() {
    setSugs([]);
    setOpen(false);
  }

  function onType(next: string) {
    onInput(next);
    clearTimeout(timer.current);
    if (next.trim().length < 3) {
      abort.current?.abort();
      close();
      return;
    }
    setOpen(true);
    timer.current = setTimeout(async () => {
      // abort the previous lookup only when a newer one replaces it
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      try {
        const found = await suggestAddresses(next, { lang, signal: ac.signal });
        if (!ac.signal.aborted) setSugs(found);
      } catch {
        // aborted by a newer keystroke: the newer lookup owns the list
      }
    }, 250) as unknown as number;
  }

  const listId = `${id}-list`;
  const showList = open && value.trim().length >= 3;
  return (
    <div style="position:relative">
      <input
        type="text"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-label={props.label}
        data-cy={props["data-cy"]}
        value={value}
        onInput={(e) => onType((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          // Escape closes the list first; the dialog's own Escape only once it is shut
          if (e.key === "Escape" && showList) {
            e.stopPropagation();
            close();
          }
        }}
        onBlur={() => setOpen(false)}
        style={props.inputStyle}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          style={LIST_STYLE}
          // options select on click; mousedown-preventDefault keeps the
          // input's blur (which closes the list) from winning the race
          onMouseDown={(e) => e.preventDefault()}
        >
          <li role="option" aria-selected={false}>
            <button
              type="button"
              data-cy={props["data-cy"] && `${props["data-cy"]}-typed`}
              style={OPT_STYLE}
              onClick={close}
            >
              <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                {value.trim()}
              </span>
              <span style="flex-shrink:0;font-size:12px;color:var(--fg-muted,#6b7560)">
                {useTypedLabel}
              </span>
            </button>
          </li>
          {sugs.map((s) => (
            <li key={s.label} role="option" aria-selected={false}>
              <button
                type="button"
                style={OPT_STYLE}
                onClick={() => {
                  onInput(s.label);
                  close();
                }}
              >
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  {s.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
