import { define } from "../../utils.ts";
import { PlaceholderPage } from "../../components/PlaceholderPage.tsx";

export default define.page(function InvoicesPage(ctx) {
  return (
    <PlaceholderPage
      user={ctx.state.user}
      active="invoices"
      title="Invoices"
      blurb="Sent, paid, and overdue invoices will live here. Today, the assistant turns a finished job into an invoice for you."
    />
  );
});
