/**
 * REQ-136 — SearchSelect: a text box with a drop-down that filters as you type.
 * Arrow keys move the highlight, Enter or a click picks, Escape closes; the pick's
 * label fills the box. Draws at most SEARCH_SELECT_LIMIT rows and says how many
 * more there are, so a thousand options stay instant. Styles: /search-select.css.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  createOffer,
  filterOptions,
  moveActive,
  SEARCH_SELECT_LIMIT,
  type SearchOption,
} from "../lib/search-select.ts";

export interface SearchSelectProps<T extends SearchOption = SearchOption> {
  options: T[];
  /** The option picked up front, by id. */
  value?: string;
  placeholder?: string;
  /** Form field name for the picked id (rendered as a hidden input). */
  name?: string;
  limit?: number;
  onSelect?: (option: T) => void;
  /** Called with the box's text as it changes (null once a pick is made). */
  onQuery?: (query: string) => void;
  /** REQ-152 — the box is locked: it shows the pick and never opens. */
  disabled?: boolean;
  /** REQ-283 — offer to create the typed text when no option carries it ("+ Add …"). */
  onCreate?: (query: string) => void;
  /** REQ-283 — the create row's text for a name (default `+ Add "<name>"`). */
  createLabel?: (name: string) => string;
  /** REQ-283 — the owner's check failed on this field: the box is aria-invalid. */
  invalid?: boolean;
}

export default function SearchSelect<T extends SearchOption = SearchOption>(
  {
    options,
    value,
    placeholder,
    name,
    limit = SEARCH_SELECT_LIMIT,
    onSelect,
    onQuery,
    disabled = false,
    onCreate,
    createLabel = (n) => `+ Add "${n}"`,
    invalid = false,
  }: SearchSelectProps<T>,
) {
  const initial = value ? options.find((o) => o.id === value) ?? null : null;
  const [picked, setPicked] = useState<T | null>(initial);
  const [query, setQuery] = useState(initial?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const uid = useMemo(() => `ss-${Math.random().toString(36).slice(2, 8)}`, []);

  // Once a pick is made its label sits in the box; the list then shows everything
  // again until the person types something else.
  const effectiveQuery = picked && query === picked.label ? "" : query;
  const result = useMemo(() => filterOptions(options, effectiveQuery, limit), [
    options,
    effectiveQuery,
    limit,
  ]);
  const rows = result.items;
  const more = result.total - rows.length;
  const offer = onCreate && !picked ? createOffer(options, query) : null;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // REQ-152 — the options may arrive after the box did (a list fetched on mount), and the
  // owner may change `value`: when the box's pick is not the owner's, take the owner's.
  useEffect(() => {
    if (!value || picked?.id === value) return;
    const o = options.find((x) => x.id === value);
    if (o) {
      setPicked(o);
      setQuery(o.label);
    }
  }, [value, options]);

  useEffect(() => {
    if (active < 0) return;
    listRef.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  function pick(o: T) {
    setPicked(o);
    setQuery(o.label);
    setOpen(false);
    setActive(-1);
    onSelect?.(o);
  }

  function create(name: string) {
    setQuery(name);
    setOpen(false);
    setActive(-1);
    onCreate?.(name);
  }

  function onInput(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    setQuery(v);
    setOpen(true);
    setActive(-1);
    if (picked && v !== picked.label) setPicked(null);
    onQuery?.(v);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((a) =>
        moveActive(a, e.key === "ArrowDown" ? 1 : -1, rows.length)
      );
    } else if (e.key === "Enter") {
      if (open && active >= 0 && rows[active]) {
        e.preventDefault();
        pick(rows[active]);
      } else if (open && rows.length === 1) {
        e.preventDefault();
        pick(rows[0]);
      } else if (open && rows.length === 0 && offer) {
        e.preventDefault();
        create(offer);
      }
    } else if (e.key === "Escape") {
      // REQ-732: an Escape that shuts the open list is not also the dialog's Escape
      if (open) e.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  }

  const listId = `${uid}-list`;
  return (
    <div
      class={`ss${open ? " ss--open" : ""}`}
      ref={rootRef}
      data-cy="search-select"
    >
      {name && <input type="hidden" name={name} value={picked?.id ?? ""} />}
      <div class="ss__field">
        <svg class="ss__icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle
            cx="8.5"
            cy="8.5"
            r="5.5"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          />
          <path
            d="M13 13l4.5 4.5"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        <input
          class="ss__input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && active >= 0
            ? `${uid}-opt-${active}`
            : undefined}
          autocomplete="off"
          spellcheck={false}
          placeholder={placeholder}
          value={query}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onInput={onInput}
          onKeyDown={onKey}
          onFocus={() => !disabled && setOpen(true)}
          onClick={() => !disabled && setOpen(true)}
          data-cy="search-select-input"
        />
        {query && !disabled && (
          <button
            type="button"
            class="ss__clear"
            aria-label="Clear"
            onClick={() => {
              setQuery("");
              setPicked(null);
              setActive(-1);
              setOpen(true);
              onQuery?.("");
              rootRef.current?.querySelector<HTMLInputElement>(".ss__input")
                ?.focus();
            }}
            data-cy="search-select-clear"
          >
            ×
          </button>
        )}
      </div>
      {open && !disabled && (
        <div class="ss__pop">
          <ul
            class="ss__list"
            role="listbox"
            id={listId}
            ref={listRef}
            data-cy="search-select-list"
          >
            {rows.map((o, i) => (
              <li
                key={o.id}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={picked?.id === o.id}
                class={`ss__opt${i === active ? " ss__opt--active" : ""}${
                  picked?.id === o.id ? " ss__opt--picked" : ""
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                data-cy="search-select-option"
              >
                <span class="ss__label" data-cy="search-select-label">
                  {o.label}
                </span>
                {o.hint && <span class="ss__hint">{o.hint}</span>}
              </li>
            ))}
            {offer && (
              <li
                class="ss__opt ss__create"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => create(offer)}
                data-cy="search-select-create"
              >
                {createLabel(offer)}
              </li>
            )}
            {rows.length === 0 && !offer && (
              <li class="ss__empty" data-cy="search-select-empty">
                No matches
              </li>
            )}
          </ul>
          {more > 0 && (
            <div class="ss__more" data-cy="search-select-more">
              {more.toLocaleString("en-US")}{" "}
              more — keep typing to narrow it down
            </div>
          )}
        </div>
      )}
    </div>
  );
}
