/**
 * REQ-785 — demo-loop cycle dv1, issue d11 (first seen cycle 3, M42): "A job that runs several
 * days can be scheduled as one job". Raphael: "Yes, multi-day jobs."
 *
 * The verifier's walk, in a real browser: Field → schedule a 3-day fence install as ONE job (a
 * first and a last day, its worker and one more on the crew); it appears on each of the 3 days
 * for the owner, and not on the day after; "Edit dates" makes it 4 days and the 4th day shows
 * it; the crew's worker sees it on /worker today ("Day 1 of 4") and tomorrow ("Day 2 of 4"),
 * checks it off once, and the owner's card reads Complete on its other days.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Fence Owner" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

/** the company's day — the backend's FIELD_TZ default (America/New_York) */
const nyIso = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
const plus = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString()
    .slice(0, 10);

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-785 (demo dv1-d11): a 3-day fence install scheduled as ONE job shows on each of its days for the owner and the crew's worker; Edit dates moves its last day; one check-off completes it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const post = async (p: string, b: unknown) => {
      const r = await http(p, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(b),
      });
      return r.json();
    };
    await post("/api/customers", {
      name: "Dana Whitfield",
      address: "12 Fence Row, Myrtle Beach, SC",
    });
    const luisCell = `843555${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const pedroCell = `843556${
      String(Math.floor(Math.random() * 9000) + 1000)
    }`;
    const luis = await post("/api/field/workers", {
      name: "Luis",
      phoneNumber: luisCell,
      pin: "1234",
      language: "en",
    });
    const pedro = await post("/api/field/workers", {
      name: "Pedro",
      phoneNumber: pedroCell,
      pin: "4321",
      language: "en",
    });
    const today = nyIso(new Date());
    const fenceCard = page.locator("[data-cy='tk-task']", {
      hasText: "Fence install",
    });

    // 1. Field → Add task: the fence install, today through the day after tomorrow, Luis + Pedro
    await page.goto("/field/tasks");
    const form = page.locator("[data-cy='tk-add-form']");
    await clickUntil(page, "[data-cy='tk-add']", () => form.isVisible());
    await form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-input']",
    )
      .fill("Dana");
    await form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-option']",
    ).filter({ hasText: "Dana Whitfield" }).first().click();
    await form.locator("[data-cy='tk-add-type']").fill("Fence install");
    await form.locator("[data-cy='tk-add-price']").fill("2400");
    await form.locator("[data-cy='tk-add-worker']").selectOption(luis.id);
    expect.eq(
      await form.locator("[data-cy='tk-add-date']").inputValue(),
      today,
      "the first day is the day on screen",
    );
    await form.locator("[data-cy='tk-add-end']").fill(plus(today, 2));
    await expect.see("3 days");
    await form.locator(
      `[data-cy='tk-add-crew-pick'][value='${pedro.id}']`,
    ).check();
    await form.locator("[data-cy='tk-add-save']").click();
    await form.waitFor({ state: "detached", timeout: 15_000 });

    // 2. ONE job, on each of its three days, and not the day after
    const spanOn = async (n: number) => {
      await fenceCard.first().waitFor({ timeout: 15_000 });
      expect.eq(await fenceCard.count(), 1, `one card on day ${n}`);
      const chip = fenceCard.locator("[data-cy='tk-span']");
      expect(
        ((await chip.textContent()) ?? "").includes(`Day ${n} of 3`),
        `the card reads "Day ${n} of 3" (got "${await chip.textContent()}")`,
      );
    };
    await spanOn(1);
    expect(
      ((await fenceCard.locator("[data-cy='tk-crew']").textContent()) ?? "")
        .includes("Pedro"),
      "the card names Pedro on the crew",
    );
    const next = async (iso: string) => {
      await page.locator("[data-cy='tk-next']").click();
      await page.waitForFunction(
        (d) =>
          (document.querySelector("[data-cy='tk-date']") as
            | HTMLInputElement
            | null)?.value === d,
        iso,
        { timeout: 15_000 },
      );
    };
    await next(plus(today, 1));
    await spanOn(2);
    await next(plus(today, 2));
    await spanOn(3);
    await next(plus(today, 3));
    await page.locator("[data-cy='tk-summary']").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    expect.eq(await fenceCard.count(), 0, "not on the day after its last day");

    // 3. Edit dates: back on its first day, the last day moves one day later
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.waitForFunction(
      (d) =>
        (document.querySelector("[data-cy='tk-date']") as
          | HTMLInputElement
          | null)?.value === d,
      today,
      { timeout: 15_000 },
    );
    await spanOn(1);
    await fenceCard.locator("[data-cy='tk-edit-dates']").click();
    const dates = fenceCard.locator("[data-cy='tk-dates-form']");
    await dates.waitFor({ timeout: 15_000 });
    expect.eq(
      await dates.locator("[data-cy='tk-dates-end']").inputValue(),
      plus(today, 2),
      "the form opens on the job's last day",
    );
    await dates.locator("[data-cy='tk-dates-end']").fill(plus(today, 3));
    await dates.locator("[data-cy='tk-dates-save']").click();
    await dates.waitFor({ state: "detached", timeout: 15_000 });
    await expect.see("Dates saved");
    const chip = fenceCard.locator("[data-cy='tk-span']");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='tk-span']")?.getAttribute(
          "data-of",
        ) === "4",
      undefined,
      { timeout: 15_000 },
    );
    expect(
      ((await chip.textContent()) ?? "").includes("Day 1 of 4"),
      `now 4 days (got "${await chip.textContent()}")`,
    );
    await page.locator("[data-cy='tk-date']").fill(plus(today, 3));
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='tk-span']")?.getAttribute(
          "data-n",
        ) ===
          "4",
      undefined,
      { timeout: 15_000 },
    );

    // 4. the crew's worker: on /worker today and tomorrow, then one check-off
    await page.goto("/worker");
    const eye = page.locator("[data-cy='w-pin-eye']");
    await clickUntil(
      page,
      "[data-cy='w-pin-eye']",
      async () => (await eye.getAttribute("aria-pressed")) === "true",
    );
    await page.locator("[data-cy='w-cell']").fill(pedroCell);
    await page.locator("[data-cy='w-pin']").fill("4321");
    await page.locator("[data-cy='w-login']").click();
    await page.getByText("Hey, Pedro").waitFor({ timeout: 15_000 });
    const visit = page.locator("[data-cy='w-visit']", {
      hasText: "Fence install",
    });
    await visit.first().waitFor({ timeout: 15_000 });
    expect(
      ((await visit.locator("[data-cy='w-job-span']").textContent()) ?? "")
        .includes("Day 1 of 4"),
      "Pedro's screen today: Day 1 of 4",
    );
    expect(
      ((await visit.locator("[data-cy='w-crew']").textContent()) ?? "")
        .includes("Luis"),
      "Pedro sees he is with Luis",
    );
    expect.eq(
      await visit.locator("[data-cy='w-defer-visit']").count(),
      0,
      "a job of several days is not deferred",
    );
    await page.locator("[data-cy='w-day-next']").click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='w-job-span']")?.getAttribute(
          "data-n",
        ) === "2",
      undefined,
      { timeout: 15_000 },
    );
    expect(
      ((await visit.locator("[data-cy='w-job-span']").textContent()) ?? "")
        .includes("Day 2 of 4"),
      "tomorrow: Day 2 of 4",
    );
    await page.locator("[data-cy='w-day-today']").click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='w-job-span']")?.getAttribute(
          "data-n",
        ) === "1",
      undefined,
      { timeout: 15_000 },
    );
    await visit.locator("[data-cy='w-check']").click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='w-check']")?.getAttribute(
          "aria-pressed",
        ) === "true",
      undefined,
      { timeout: 15_000 },
    );

    // 5. done once: the owner's card reads Complete on its third day too
    const day3 = await http(`/api/field/tasks?date=${plus(today, 2)}`, {
      headers: auth,
    });
    const rows = (await day3.json()) as {
      taskTypeName: string;
      status: string;
    }[];
    expect.eq(
      JSON.stringify(
        rows.filter((r) => r.taskTypeName === "Fence install").map((r) =>
          r.status
        ),
      ),
      JSON.stringify(["complete"]),
      "one job, complete, on its third day",
    );
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-date']").waitFor({ timeout: 15_000 });
    await clickUntil(
      page,
      "[data-cy='tk-next']",
      async () =>
        (await page.locator("[data-cy='tk-date']").inputValue()) ===
          plus(today, 1),
    );
    await next(plus(today, 2));
    await fenceCard.first().waitFor({ timeout: 15_000 });
    expect.eq(
      await fenceCard.first().getAttribute("data-status"),
      "complete",
      "the owner's card on day 3 reads complete",
    );
    await expect.see("Complete");
  }));
