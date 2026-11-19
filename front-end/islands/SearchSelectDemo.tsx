/** REQ-136 — the dev page's harness: SearchSelect plus a line that prints the pick.
 *  REQ-987 — the page is English throughout, so the picker's copy is pinned to `en`. */
import { useState } from "preact/hooks";
import SearchSelect from "./SearchSelect.tsx";
import type { SearchOption } from "../lib/search-select.ts";

export default function SearchSelectDemo(
  { options }: { options: SearchOption[] },
) {
  const [picked, setPicked] = useState<SearchOption | null>(null);
  return (
    <>
      <SearchSelect
        options={options}
        placeholder="Search a customer…"
        lang="en"
        onSelect={setPicked}
      />
      <p style="margin-top:20px;font-size:15px" data-cy="search-select-picked">
        {picked
          ? `Picked: ${picked.label} (${picked.id})`
          : "Nothing picked yet."}
      </p>
    </>
  );
}
