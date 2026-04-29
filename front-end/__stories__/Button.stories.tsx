import { Button } from "../components/Button.tsx";
import type { Story } from "denostories";

export const Default: Story = () => <Button>Click me</Button>;

export const Disabled: Story = () => <Button disabled>Disabled</Button>;

export const LongLabel: Story = () => (
  <Button>This is a button with a longer label</Button>
);
