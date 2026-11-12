/**
 * REQ-338 — demo issue m31 (cycle 1): "The 'Looks right' card overlaps the
 * option list" at 1280×720.
 *
 * In "help me price it" the confirm step renders the three scope cards in a
 * scroll box and, below it, the green "Looks right — confirm these details"
 * strip echoing the typed message. The list's height used to be a fixed
 * `calc(100dvh - 235px)` and the strip's echo was unbounded, so a long message
 * pushed the strip over the list. In a 1280×720 browser with an ~800-char
 * message: the strip and the list never share pixels, the whole picker fits
 * in the viewport, the echo is clamped to three lines with a "show more"
 * control that reveals the rest, and the third card is still reachable by
 * scrolling the list.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

/** ~800 chars, like the pair-7 demo message */
const TYPED = [
  "Full gut of the hall bathroom for the Kowalskis at 418 Pecan Street.",
  "Demo everything to the studs, haul away, cut the slab for a curbless shower with a linear drain.",
  "Plumber is my sub, about $3200 for rough + finish, he also moves the toilet 18 inches.",
  "Frameless glass enclosure, 72 inch double vanity (they buy the vanity), 4 recessed lights with a permit.",
  "Large format porcelain tile on the floor and shower walls, niche in the shower, heated floor mat.",
  "Paint the whole room, new exhaust fan vented to the roof, new trim and door.",
  "About 4 weeks start to finish. wife mentioned maybe the hall powder room too but not sure yet.",
  "what should I charge??",
].join("\n");

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
  });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: body.recoveryToken }),
    });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  const auth = { ...JSON_HEADERS, cookie };
  await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  })
    .then((x) => x.body?.cancel());
  await answerQuestions(http, auth, {
    name: "Bath Pro",
    businessName: "Bath Pro LLC",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
) {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch { /* not clickable yet */ }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
interface Layout {
  innerHeight: number;
  scroll: Box;
  list: Box;
  listScrollHeight: number;
  listClientHeight: number;
  strip: Box;
  echo: Box | null;
  echoLineHeight: number;
  picker: Box;
  continueBottom: number;
  cards: number;
}
function measure(page: StoryTools["page"]): Promise<Layout> {
  return page.evaluate(() => {
    const box = (el: Element | null): Box => {
      const r = el?.getBoundingClientRect();
      return r
        ? {
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          left: Math.round(r.left),
          right: Math.round(r.right),
        }
        : { top: -1, bottom: -1, left: -1, right: -1 };
    };
    const list = document.querySelector(".chat__jobopts-list");
    const strip = document.querySelector("[data-cy=confirm-details]");
    const echo = document.querySelector(".chat__confirm-details-text");
    const picker = document.querySelector(".chat__jobopts");
    const cont = picker?.querySelector(".chat__price-continue");
    return {
      innerHeight: globalThis.innerHeight,
      scroll: box(document.querySelector(".chat__scroll")),
      list: box(list),
      listScrollHeight: list?.scrollHeight ?? -1,
      listClientHeight: list?.clientHeight ?? -1,
      strip: box(strip),
      echo: echo ? box(echo) : null,
      echoLineHeight: echo ? parseFloat(getComputedStyle(echo).lineHeight) : 0,
      picker: box(picker),
      continueBottom: box(cont ?? null).bottom,
      cards: document.querySelectorAll(".chat__jobopt").length,
    };
  });
}
const overlap = (a: Box, b: Box) =>
  a.top < b.bottom && b.top < a.bottom && a.left < b.right && b.left < a.right;

Deno.test("REQ-338 m31: at 1280×720 the 'Looks right' strip never covers the option list — the echo is clamped and the list takes the room that is left", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/assistant");
    const chip = "button.chat__empty-prompt:has-text('help me price it')";
    const composer = page.locator("textarea.composer__input");
    await clickUntil(
      page,
      chip,
      () => page.locator(".chat__details-prompt-bubble").isVisible(),
    );
    await composer.fill(TYPED);
    await page.locator("button.composer__send").click();
    await page.locator("[data-cy=confirm-details]").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.locator(".chat__jobopt").nth(2).waitFor({ state: "attached" });
    await page.waitForTimeout(400); // the picker's entrance animation

    const m = await measure(page);
    expect.eq(m.innerHeight, 720, "the window is 720px tall");
    expect.eq(m.cards, 3, "three scope cards");
    expect(
      !overlap(m.strip, m.list),
      `the strip (${m.strip.top}–${m.strip.bottom}) does not overlap the list (${m.list.top}–${m.list.bottom})`,
    );
    expect(
      m.strip.top >= m.list.bottom,
      `the strip sits below the list (strip top ${m.strip.top}, list bottom ${m.list.bottom})`,
    );
    expect(
      m.continueBottom <= 720 && m.picker.top >= 0 &&
        m.picker.top >= m.scroll.top && m.continueBottom <= m.scroll.bottom,
      `the whole picker fits in the chat panel (picker top ${m.picker.top}, Continue bottom ${m.continueBottom}; panel ${m.scroll.top}–${m.scroll.bottom})`,
    );
    expect(m.echo !== null, "the strip echoes the typed message");
    const echoLines = (m.echo!.bottom - m.echo!.top) / m.echoLineHeight;
    expect(
      echoLines <= 3.2,
      `the echo is clamped to three lines (${echoLines.toFixed(1)} lines)`,
    );
    expect(
      m.listScrollHeight > m.listClientHeight,
      `the list scrolls for the cards it cannot show (scroll ${m.listScrollHeight} > client ${m.listClientHeight})`,
    );

    // the third card is reachable by scrolling the list, and the strip stays below the list
    await page.evaluate(() => {
      const list = document.querySelector(".chat__jobopts-list")!;
      const third = document.querySelectorAll(
        ".chat__jobopt",
      )[2] as HTMLElement;
      list.scrollTop = third.offsetTop - (list as HTMLElement).offsetTop;
    });
    const after = await measure(page);
    const third = await page.locator(".chat__jobopt").nth(2).boundingBox();
    const thirdTop = third ? Math.round(third.y) : -1;
    expect(
      thirdTop >= after.list.top - 1 && thirdTop < after.list.bottom &&
        after.list.bottom <= after.strip.top,
      `scrolled, the third card shows in the list, above the strip (card top ${thirdTop}; list ${after.list.top}–${after.list.bottom}; strip top ${after.strip.top})`,
    );

    // "show more" opens the whole message; the cards stay in sight and Continue reachable
    const more = page.locator("[data-cy=confirm-details-more]");
    expect.eq(
      await more.count(),
      1,
      "a 'show more' control on the clamped echo",
    );
    await more.click();
    const open = await measure(page);
    const openEcho = await page.evaluate(() => {
      const e = document.querySelector(".chat__confirm-details-text")!;
      return { scroll: e.scrollHeight, client: e.clientHeight };
    });
    const openLines = (open.echo!.bottom - open.echo!.top) /
      open.echoLineHeight;
    expect(
      openLines > 3.2 && openEcho.scroll >= 12 * open.echoLineHeight,
      `after 'show more' the echo opens past three lines and holds the whole message (${
        openLines.toFixed(1)
      } lines shown, ${openEcho.scroll}px of text)`,
    );
    expect(
      open.listClientHeight >= 60,
      `expanded, the cards stay in sight (list ${open.listClientHeight}px tall)`,
    );
    expect(
      !overlap(open.strip, open.list) && open.list.bottom <= open.strip.top,
      `expanded, the strip still sits below the list (list bottom ${open.list.bottom}, strip top ${open.strip.top})`,
    );
    // Continue is reachable: scrolled to the end, the chat panel shows it
    await page.evaluate(() => {
      const sc = document.querySelector(".chat__scroll")!;
      sc.scrollTop = sc.scrollHeight;
    });
    const end = await measure(page);
    expect(
      end.continueBottom <= end.scroll.bottom + 1 &&
        !overlap(end.strip, end.list),
      `expanded and scrolled, Continue is in the panel (Continue bottom ${end.continueBottom}, panel bottom ${end.scroll.bottom})`,
    );
  }));
