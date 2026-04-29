import { define } from "../../utils.ts";
import { PlaceholderPage } from "../../components/PlaceholderPage.tsx";

export default define.page(function SettingsPage(ctx) {
  return (
    <PlaceholderPage
      user={ctx.state.user}
      active="settings"
      title="Settings"
      blurb="Account, business profile, payment defaults, and language preferences will live here. The backend already exposes /profile, /me, and /profile/contract-defaults — wiring is next."
    />
  );
});
