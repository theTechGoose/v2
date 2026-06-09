import type { Signal } from "@preact/signals";
import { Button } from "../components/Button.tsx";
import { tFor } from "../lib/i18n.ts";

interface CounterProps {
  count: Signal<number>;
  lang?: "en" | "es";
}

export default function Counter(props: CounterProps) {
  const lang = props.lang ?? "en";
  return (
    <div class="flex gap-8 py-6">
      <Button id="decrement" onClick={() => props.count.value -= 1}>
        {tFor(lang, "counter.decrement")}
      </Button>
      <p class="text-3xl tabular-nums">{props.count}</p>
      <Button id="increment" onClick={() => props.count.value += 1}>
        {tFor(lang, "counter.increment")}
      </Button>
    </div>
  );
}
