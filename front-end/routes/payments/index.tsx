import { define } from "../../utils.ts";
import { PlaceholderPage } from "../../components/PlaceholderPage.tsx";

export default define.page(function PaymentsPage(ctx) {
  return (
    <PlaceholderPage
      user={ctx.state.user}
      active="payments"
      title="Payments"
      blurb="Payment history and outstanding balances will live here. Until then, the assistant can nudge clients on overdue invoices."
    />
  );
});
