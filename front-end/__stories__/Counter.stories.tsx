import { signal } from "@preact/signals";
import Counter from "../islands/Counter.tsx";
import type { Story } from "denostories";

export const Zero: Story = () => <Counter count={signal(0)} />;

export const Positive: Story = () => <Counter count={signal(42)} />;

export const Negative: Story = () => <Counter count={signal(-7)} />;
