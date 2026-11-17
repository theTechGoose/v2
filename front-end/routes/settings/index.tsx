import { asset, Head } from "fresh/runtime";
import { greetingFirstName } from "../../../shared/person-name/mod.ts"; // REQ-624
import { define } from "../../utils.ts";
import { resolveSsrLang } from "../../lib/ssr-lang.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { type Lang, tFor } from "../../lib/i18n.ts";
import DashSidebar from "../../islands/DashSidebar.tsx";
import DashTopbar from "../../islands/DashTopbar.tsx";
import SettingsPage from "../../islands/SettingsPage.tsx";
import { MetaPixelEvent } from "../../components/MetaPixel.tsx";
import { subscribeEventFrom } from "../../../shared/meta-pixel/pixel.ts";

const WEEKDAY_KEYS = [
  "date.weekday.sunday",
  "date.weekday.monday",
  "date.weekday.tuesday",
  "date.weekday.wednesday",
  "date.weekday.thursday",
  "date.weekday.friday",
  "date.weekday.saturday",
];
const MONTH_KEYS = [
  "date.month.january",
  "date.month.february",
  "date.month.march",
  "date.month.april",
  "date.month.may",
  "date.month.june",
  "date.month.july",
  "date.month.august",
  "date.month.september",
  "date.month.october",
  "date.month.november",
  "date.month.december",
];

export default define.page(function SettingsRoute(ctx) {
  const user = ctx.state.user;
  // REQ-709 (demo-loop c5, m4): the islands' language (?lang= > account >
  // pm_lang), so the tab title and footer match the page they sit on.
  const lang: Lang = resolveSsrLang(ctx) ?? "es";
  const greetingName = greetingFirstName(user);
  const now = new Date();
  const greetingDate = `${tFor(lang, WEEKDAY_KEYS[now.getDay()])} · ${
    tFor(lang, MONTH_KEYS[now.getMonth()])
  } ${now.getDate()}`;
  // REQ-080: the receipt of an upgrade comes back here (/plan/return ?px=sub:…) — a Subscribe for the ads
  const subscribed = subscribeEventFrom(ctx.url.searchParams.get("px"));

  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) => tFor(l, "settingsRoute.docTitle")}
        />
        <link
          key="css-dashboard"
          rel="stylesheet"
          href={asset("/dashboard.css")}
        />
        <link
          key="css-plan-cards"
          rel="stylesheet"
          href={asset("/plan-cards.css")}
        />
        {subscribed ? <MetaPixelEvent event={subscribed} /> : null}
      </Head>
      <div class="app">
        <DashSidebar active="settings" />
        <main class="main">
          <DashTopbar
            pageTitleKey="appNav.settings"
            greetingDate={greetingDate}
            greetingName={greetingName}
          />
          <div class="content">
            <SettingsPage />
            <SiteFooter lang={lang} compact />
          </div>
        </main>
      </div>
    </>
  );
});
