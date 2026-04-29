import { define } from "../../utils.ts";
import { PlaceholderPage } from "../../components/PlaceholderPage.tsx";

export default define.page(function JobsPage(ctx) {
  return (
    <PlaceholderPage
      user={ctx.state.user}
      active="jobs"
      title="Jobs"
      blurb="Active jobs board coming online — schedule, crew, and progress in one view. For now, work tracking lives inside each conversation in the assistant."
    />
  );
});
