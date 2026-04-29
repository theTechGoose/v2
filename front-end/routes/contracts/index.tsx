import { define } from "../../utils.ts";
import { PlaceholderPage } from "../../components/PlaceholderPage.tsx";

export default define.page(function ContractsPage(ctx) {
  return (
    <PlaceholderPage
      user={ctx.state.user}
      active="contracts"
      title="Contracts"
      blurb="Signed and pending contracts will live here. Today, you can draft and send a contract from any conversation in the assistant."
    />
  );
});
