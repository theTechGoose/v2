import { Button } from "../components/ui/Button.tsx";
import type { Story } from "denostories";

export const Primary: Story = () => (
  <Button variant="primary">Primary action</Button>
);

export const Outline: Story = () => (
  <Button variant="outline">Outline action</Button>
);

export const Ghost: Story = () => (
  <Button variant="ghost">Ghost action</Button>
);

export const Large: Story = () => (
  <Button variant="primary" size="lg">Large primary</Button>
);
