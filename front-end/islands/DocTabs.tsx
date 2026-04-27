import { useState } from "preact/hooks";
import { langSignal, STRINGS } from "../lib/lang.ts";

export default function DocTabs() {
  const [active, setActive] = useState(0);
  const tabs = STRINGS[langSignal.value]["docs.tabs"] as readonly string[];

  return (
    <div class="doc-tabs">
      <div class="doc-tabs__head" role="tablist">
        {tabs.map((label, i) => (
          <button
            type="button"
            class={`doc-tabs__tab ${i === active ? "active" : ""}`}
            onClick={() => setActive(i)}
            role="tab"
            aria-selected={i === active}
            key={label}
          >
            {label}
          </button>
        ))}
      </div>
      <div class="doc-mock" role="tabpanel">
        <div class="doc-line short" />
        <div class="doc-line" />
        <div class="doc-line medium" />
        <div class="doc-line" />
        <div class="doc-line short" />
        <div class="doc-line medium" />
      </div>
    </div>
  );
}
