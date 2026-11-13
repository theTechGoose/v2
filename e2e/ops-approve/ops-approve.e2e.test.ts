/**
 * REQ-806 — the approve-link door on the real shell: an ask names an account; the phone's link
 * opens /ops/approve/:token (reading it changes nothing); Approve gives the asker a read-only view
 * of that one account, handed over once; Deny opens nothing.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function mkAccount(http: StoryTools["http"], business: string) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Ops Story" }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ businessName: business }),
  })).body?.cancel();
  const me = await (await http("/api/me", { headers: auth })).json();
  return { id: (me.id ?? me.user?.id) as string };
}

Deno.test("REQ-806: Approve on /ops/approve/:token gives the asker a read-only view of that one account, once; Deny opens nothing", (t) =>
  story(t, async ({ page, expect, http }) => {
    const business = `Ops Story Landscaping ${digits()}`;
    const acct = await mkAccount(http, business);

    const ask = await (await http("/api/ops/requests", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ account: business, reason: "check Xpress Pay" }),
    })).json();
    expect(
      !!ask.devApproveToken,
      `the fake hands the link's token back (${JSON.stringify(ask)})`,
    );
    const poll = async () =>
      await (await http(`/api/ops/requests/${ask.id}`, {
        headers: { ...JSON_HEADERS, "x-ops-poll": ask.pollToken },
      })).json();

    await page.goto(`/ops/approve/${ask.devApproveToken}`);
    await page.locator("[data-cy='ops-approve']").waitFor({ timeout: 15_000 });
    await expect.see(`Claude asks to view ${business}`);
    await expect.see("Read-only, for 30 minutes");
    await expect.see("Reason: check Xpress Pay");
    expect.eq(
      (await poll()).status,
      "pending",
      "opening the page approves nothing",
    );

    await page.locator("[data-cy='ops-approve-yes']").click();
    await page.locator("[data-cy='ops-approve-status']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Approved. The view closes by itself in 30 minutes.");
    expect.eq(
      await page.locator("[data-cy='ops-approve-yes']").count(),
      0,
      "no second approve",
    );

    const got = await poll();
    expect.eq(got.status, "approved", "approved");
    expect(!!got.sessionId, "the asker gets the view");
    expect.eq((await poll()).sessionId, undefined, "once");
    const view = { ...JSON_HEADERS, "x-session-id": got.sessionId as string };
    const me = await (await http("/api/me", { headers: view })).json();
    expect.eq(me.id ?? me.user?.id, acct.id, "the view is that account");
    const w = await http("/api/me", {
      method: "PUT",
      headers: view,
      body: JSON.stringify({ name: "Changed" }),
    });
    expect.eq(w.status, 403, "and it cannot write");
    await w.body?.cancel();

    // a second ask, denied
    const ask2 = await (await http("/api/ops/requests", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ account: business, reason: "again" }),
    })).json();
    await page.goto(`/ops/approve/${ask2.devApproveToken}`);
    await page.locator("[data-cy='ops-approve-no']").click();
    await page.locator("[data-cy='ops-approve-status']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Denied. Nothing was opened.");
    const p2 = await (await http(`/api/ops/requests/${ask2.id}`, {
      headers: { ...JSON_HEADERS, "x-ops-poll": ask2.pollToken },
    })).json();
    expect.eq(p2.status, "denied", "denied");
    expect.eq(p2.sessionId, undefined, "no view");
  }));
