import { useState } from "preact/hooks";
import MoneyInput from "../islands/MoneyInput.tsx";
import type { Story } from "denostories";

const SHELL_STYLE =
  "padding:48px 32px;max-width:560px;margin:0 auto;font-family:Inter,system-ui,sans-serif";

export const Empty: Story = () => (
  <div style={SHELL_STYLE}>
    <MoneyInput />
  </div>
);

export const Prefilled: Story = () => (
  <div style={SHELL_STYLE}>
    <MoneyInput initialCents={2_499_99} />
  </div>
);

export const BigAmount: Story = () => (
  <div style={SHELL_STYLE}>
    <MoneyInput initialCents={123_456_789} />
  </div>
);

export const Mega: Story = () => (
  <div style={SHELL_STYLE}>
    <MoneyInput initialCents={100_000_000_00} />
  </div>
);

export const NearMax: Story = () => (
  <div style={SHELL_STYLE}>
    <MoneyInput initialCents={99_999_999_99} />
  </div>
);

export const WithLiveReadout: Story = () => {
  const [cents, setCents] = useState<number | null>(null);
  return (
    <div style={SHELL_STYLE}>
      <MoneyInput onChange={setCents} />
      <div
        style="display:flex;gap:10px;align-items:baseline;margin-top:14px;padding-left:4px;font:12px Inter,system-ui,sans-serif;color:#7E8F92"
      >
        <span style="text-transform:uppercase;letter-spacing:.12em;font-weight:700;font-size:10px">
          cents
        </span>
        <span style="font-variant-numeric:tabular-nums;color:#1A535C;font-weight:600">
          {cents ?? "—"}
        </span>
      </div>
    </div>
  );
};
