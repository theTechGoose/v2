/**
 * REQ-921 — the one way to say what a line bills: the house search picker
 * (SearchSelect, REQ-136) over the account's services (the /field/services
 * catalogue). Type to narrow, click or Enter to pick; nothing typed is ever
 * billed as free text. REQ-979 (amends REQ-921): with `onCreate`, a name that
 * matches no service offers `+ Add "<name>" as a service`; the owner creates
 * it in the catalogue and picks it, so the line still bills a real service.
 * A line saved before REQ-921 whose name
 * is not a service keeps that name as its own option, so opening an old
 * invoice never silently renames a line.
 */
import SearchSelect from "../islands/SearchSelect.tsx";
import { type Lang, tFor } from "../lib/i18n.ts";
import {
  type CatalogService,
  serviceChoices,
} from "../../shared/documents/service-lines.ts";

/** the option id that stands for "keep this line's own name" */
export const KEEP_NAME = "__keep__";

/** the picker's rows and the picked id for a line (pure — the islands' seam) */
export function serviceOptions(
  catalog: readonly CatalogService[],
  serviceId: string,
  name: string,
): { options: Array<{ id: string; label: string }>; value: string } {
  const choices = serviceChoices(catalog, serviceId || undefined);
  const known = choices.some((s) => s.id === serviceId);
  const typed = name.trim();
  const byName = !known && typed
    ? choices.find((s) => s.name.toLowerCase() === typed.toLowerCase())
    : undefined;
  const legacy = !known && !byName && typed ? typed : "";
  const options = [
    ...(legacy ? [{ id: KEEP_NAME, label: legacy }] : []),
    ...choices.map((s) => ({ id: s.id, label: s.name })),
  ];
  const value = known
    ? serviceId
    : byName
    ? byName.id
    : legacy
    ? KEEP_NAME
    : "";
  return { options, value };
}

export default function ServiceSelect(
  {
    catalog,
    serviceId,
    name,
    lang,
    disabled,
    onPick,
    onCreate,
    onQuery,
    style,
    ...rest
  }: {
    catalog: readonly CatalogService[];
    serviceId: string;
    /** the row's current name (shown as its own option when it is no service) */
    name: string;
    lang: Lang;
    disabled?: boolean;
    onPick: (serviceId: string) => void;
    /** REQ-979 — offer to add a typed name that is no service; the owner
     *  creates it in the catalogue and picks it */
    onCreate?: (name: string) => void;
    /** REQ-1143 — the box's text as it is typed (a caller can add it without a pick) */
    onQuery?: (query: string) => void;
    /** the wrapper's style (the picker fills it) */
    style?: string;
    "data-cy"?: string;
    "aria-label"?: string;
  },
) {
  const { options, value } = serviceOptions(catalog, serviceId, name);
  return (
    <div
      data-cy={rest["data-cy"]}
      data-value={value}
      aria-label={rest["aria-label"]}
      style={`min-width:0${style ? `;${style}` : ""}`}
    >
      {
        /* keyed by the pick alone: a parent that clears or shifts the row gets a fresh
          box (never the previous row's label), while a catalogue that arrives late
          never resets what is being typed */
      }
      <SearchSelect
        key={value || "none"}
        options={options}
        value={value || undefined}
        placeholder={tFor(lang, "serviceLines.pick")}
        lang={lang}
        disabled={disabled}
        onSelect={(o) => {
          if (o.id !== KEEP_NAME) onPick(o.id);
        }}
        onCreate={onCreate}
        onQuery={onQuery}
        createLabel={(n) => tFor(lang, "serviceLines.create", { name: n })}
      />
    </div>
  );
}
