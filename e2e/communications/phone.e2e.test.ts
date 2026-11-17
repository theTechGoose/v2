/**
 * REQ-915/916 — the Phone page in the browser, end to end, against the real
 * communications API with Twilio stood in by a local server (the stand-in from
 * backend/src/communications/entrypoints/e2e.test.ts): an owner with no line
 * gets the number shop, searches 843, buys a number (subaccount → key → TwiML
 * App → number on the stand-in), texts a number from the page, a SIGNED
 * inbound text and a delivery report land, the thread shows both; an inbound
 * call with its AI transcript (a ConversationRelay session on the backend's
 * socket) and a voicemail shows in the Calls tab and opens; the softphone
 * says "Not registered: …" in one line when the Voice SDK cannot load from
 * the CDN while the rest of the page works; Release returns the page to the
 * shop and the stand-in sees the number freed and the subaccount closed.
 *
 * The served app reads COMMS_* at boot and `shots run` passes its own env to
 * the server, so run it as:
 *
 *   COMMS_TWILIO_ACCOUNT_SID=ACphoneE2E COMMS_TWILIO_AUTH_TOKEN=phone-e2e-token \
 *   COMMS_TWILIO_BASE_URL=http://127.0.0.1:9148 COMMS_PUBLIC_URL=https://phone-e2e.test/api \
 *   deno task test:e2e e2e/communications/phone.e2e.test.ts
 *
 * Without COMMS_TWILIO_BASE_URL the story records itself skipped with that reason.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

const SUB_SID = "ACsubPhone";
const SUB_TOKEN = "sub-phone-token";
const SUB_NUMBER = "+18435550177";
const PEER = "+15125559876";

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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      language: "en",
      name: "Phone Story",
      email: "phone-story@example.com",
    }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  await page.context().addCookies([{ name, value, url: baseUrl }]);
  return { auth };
}

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
  throw new Error(`clickUntil: ${selector} never had its effect`);
}

/** Twilio's request signature (HMAC-SHA1 of url + sorted params, base64) */
async function twilioSignature(
  token: string,
  url: string,
  params: Record<string, string>,
): Promise<string> {
  const enc = new TextEncoder();
  const data = url +
    Object.keys(params).sort().map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(token),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

/** Twilio, as far as this story is concerned: provisioning, the number search, Messages */
function twilioStandIn(
  account: string,
  method: string,
  path: string,
  form: URLSearchParams,
): { status: number; body: unknown } {
  const json = (body: unknown, status = 201) => ({ status, body });
  if (path === "/2010-04-01/Accounts.json") {
    return json({
      sid: SUB_SID,
      auth_token: SUB_TOKEN,
      friendly_name: form.get("FriendlyName"),
      status: "active",
    });
  }
  if (path === `/2010-04-01/Accounts/${SUB_SID}/Keys.json`) {
    return json({ sid: "SKsubPhone", secret: "sub-phone-key-secret" });
  }
  if (path === `/2010-04-01/Accounts/${SUB_SID}/Applications.json`) {
    return json({ sid: "APsubPhone", voice_url: form.get("VoiceUrl") });
  }
  if (path === `/2010-04-01/Accounts/${SUB_SID}/IncomingPhoneNumbers.json`) {
    return json({ sid: "PNsubPhone", phone_number: form.get("PhoneNumber") });
  }
  if (
    method === "DELETE" &&
    path ===
      `/2010-04-01/Accounts/${SUB_SID}/IncomingPhoneNumbers/PNsubPhone.json`
  ) return { status: 204, body: null };
  if (path === `/2010-04-01/Accounts/${SUB_SID}.json`) {
    return json({ sid: SUB_SID, status: form.get("Status") }, 200);
  }
  if (
    path.startsWith(
      `/2010-04-01/Accounts/${account}/AvailablePhoneNumbers/US/Local.json`,
    )
  ) {
    return json({
      available_phone_numbers: [{
        phone_number: SUB_NUMBER,
        friendly_name: "(843) 555-0177",
        locality: "Myrtle Beach",
        region: "SC",
        capabilities: { voice: true, SMS: true, MMS: true },
      }],
    }, 200);
  }
  if (path.endsWith("/Messages.json")) {
    return json({ sid: "SMsubPhone", status: "queued" });
  }
  return json(
    { code: 20404, message: `stand-in: no route for ${method} ${path}` },
    404,
  );
}

Deno.test("REQ-915/916: no line → the shop → buy → text out, signed text in → the thread; the Calls tab opens a call's transcript; the softphone says not registered; release", (t) =>
  story(t, async ({ page, expect, http, baseUrl, skip }) => {
    const twilioBase = Deno.env.get("COMMS_TWILIO_BASE_URL");
    const account = Deno.env.get("COMMS_TWILIO_ACCOUNT_SID");
    const publicUrl = Deno.env.get("COMMS_PUBLIC_URL")?.replace(/\/+$/, "");
    if (!twilioBase || !account || !publicUrl) {
      skip(
        "needs COMMS_TWILIO_BASE_URL (a local port), COMMS_TWILIO_ACCOUNT_SID, COMMS_TWILIO_AUTH_TOKEN and COMMS_PUBLIC_URL in the env of `deno task test:e2e` — the served app reads them at boot",
      );
    }

    // Twilio, stood in
    const seen: { method: string; path: string; form: URLSearchParams }[] = [];
    const twilio = Deno.serve(
      { port: Number(new URL(twilioBase!).port), onListen() {} },
      async (req) => {
        const u = new URL(req.url);
        const form = new URLSearchParams(await req.text());
        seen.push({ method: req.method, path: u.pathname, form });
        const { status, body } = twilioStandIn(
          account!,
          req.method,
          u.pathname,
          form,
        );
        return body === null
          ? new Response(null, { status })
          : new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });
      },
    );

    /** a webhook from Twilio for the bought line, signed with ITS token */
    const webhook = async (route: string, params: Record<string, string>) => {
      const p = { AccountSid: SUB_SID, ...params };
      const res = await http(`/api${route}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": await twilioSignature(
            SUB_TOKEN,
            `${publicUrl}${route}`,
            p,
          ),
        },
        body: new URLSearchParams(p).toString(),
      });
      await res.body?.cancel();
      return res.status;
    };

    try {
      const { auth } = await signIn(http, page, baseUrl);
      // REQ-916c — the Voice SDK cannot reach the CDN: the panel must say so and nothing else breaks
      await page.route("https://esm.sh/**", (r) => r.abort());

      // 1. no line yet: the page is the number shop (REQ-915a)
      await page.goto("/communications");
      await page.locator("[data-cy='comms-page'][data-mode='shop']").waitFor({
        timeout: 30_000,
      });
      await expect.see("Get a number");
      await page.locator("[data-cy='comms-search']").fill("843");
      await clickUntil(
        page,
        "[data-cy='comms-search-go']",
        async () => await page.locator("[data-cy='comms-number']").count() > 0,
      );
      await expect.see("(843) 555-0177");
      await expect.see("Myrtle Beach, SC");
      expect(
        seen.some((c) =>
          c.path ===
            `/2010-04-01/Accounts/${account}/AvailablePhoneNumbers/US/Local.json`
        ),
        "the search went to Twilio's AvailablePhoneNumbers for area code 843",
      );

      // 2. buy it: the page becomes the line's
      await page.locator("[data-cy='comms-buy']").first().click();
      await page.locator("[data-cy='comms-page'][data-mode='line']").waitFor({
        timeout: 30_000,
      });
      expect.eq(
        (await page.locator("[data-cy='comms-line-number']").textContent())
          ?.trim(),
        "(843) 555-0177",
        "the line card shows the bought number",
      );
      expect.eq(
        seen.filter((c) => c.method === "POST").map((c) => c.path).slice(-4)
          .join(" | "),
        [
          "/2010-04-01/Accounts.json",
          `/2010-04-01/Accounts/${SUB_SID}/Keys.json`,
          `/2010-04-01/Accounts/${SUB_SID}/Applications.json`,
          `/2010-04-01/Accounts/${SUB_SID}/IncomingPhoneNumbers.json`,
        ].join(" | "),
        "subaccount → key → TwiML App → number, on the stand-in",
      );

      // 3. the softphone: one line, the reason (REQ-916c)
      await page.waitForFunction(
        () =>
          document.querySelector("[data-cy='comms-phone']")?.getAttribute(
            "data-phase",
          ) === "error",
        undefined,
        { timeout: 30_000 },
      );
      expect.eq(
        (await page.locator("[data-cy='comms-phone-status']").textContent())
          ?.replace("Try again", "").trim(),
        "Not registered: the phone library couldn't load",
        "the softphone says why it is not registered, in one line",
      );

      // 4. New text to a number (REQ-915b)
      await clickUntil(
        page,
        "[data-cy='comms-new-text']",
        async () => await page.locator("[data-cy='comms-new-to']").isVisible(),
      );
      await page.locator("[data-cy='comms-new-to']").fill("512-555-9876");
      await page.locator("[data-cy='comms-compose']").fill(
        "Hello from the Phone page",
      );
      await page.locator("[data-cy='comms-send']").click();
      await page.locator(`[data-cy='comms-thread'][data-peer='${PEER}']`)
        .waitFor();
      await page.locator("[data-cy='comms-msg'][data-status='queued']")
        .waitFor();
      const out = seen.at(-1)!;
      expect.eq(
        [out.path, out.form.get("From"), out.form.get("To")].join(" | "),
        [`/2010-04-01/Accounts/${SUB_SID}/Messages.json`, SUB_NUMBER, PEER]
          .join(" | "),
        "the text left from the bought number, on its subaccount",
      );
      // leave the conversation closed, so the 15 s poll does not read the reply before we look
      await page.reload();
      await page.locator("[data-cy='comms-page'][data-mode='line']").waitFor({
        timeout: 30_000,
      });

      // 5. Twilio reports it delivered; the peer texts back — both signed with the line's token
      expect.eq(
        await webhook("/communications/twilio/sms-status", {
          MessageSid: "SMsubPhone",
          MessageStatus: "delivered",
        }),
        204,
        "the delivery report was accepted",
      );
      expect.eq(
        await webhook("/communications/twilio/sms", {
          MessageSid: "SMphoneIn",
          From: PEER,
          To: SUB_NUMBER,
          Body: "Got it, thanks!",
        }),
        200,
        "the signed inbound text was accepted",
      );

      // 6. an inbound call: rang, then the AI receptionist talked, then a voicemail; completed in 42 s
      expect.eq(
        await webhook("/communications/twilio/voice/incoming", {
          CallSid: "CAphone",
          From: PEER,
          To: SUB_NUMBER,
          CallStatus: "ringing",
        }),
        200,
        "the inbound call webhook was accepted",
      );
      const calls = await (await http("/api/communications/calls", {
        headers: auth,
      })).json() as { id: string; providerSid: string }[];
      const callId = calls.find((c) => c.providerSid === "CAphone")!.id;
      // the ConversationRelay socket is Twilio's, on the backend (serve.ts: PORT + 1)
      const backendPort = Number(new URL(baseUrl).port) + 1;
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${backendPort}/communications/voice/relay`,
        );
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("relay: no reply in 30 s"));
        }, 30_000);
        ws.onopen = () => {
          ws.send(JSON.stringify({
            type: "setup",
            sessionId: "VXphone",
            callSid: "CAphone",
            from: PEER,
            to: SUB_NUMBER,
            customParameters: { callId },
          }));
          ws.send(JSON.stringify({
            type: "prompt",
            voicePrompt: "Hi, I need a cleaning quote",
            last: true,
          }));
        };
        ws.onmessage = () => {
          clearTimeout(timer);
          ws.close();
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error("relay: socket error"));
        };
      });
      expect.eq(
        await webhook("/communications/twilio/voice/recording", {
          CallSid: "CAphone",
          RecordingSid: "REphone",
          RecordingUrl: `${twilioBase}/recordings/REphone`,
          RecordingStatus: "completed",
          RecordingDuration: "9",
        }),
        204,
        "the recording webhook was accepted",
      );
      expect.eq(
        await webhook("/communications/twilio/voice/status", {
          CallSid: "CAphone",
          CallStatus: "completed",
          CallDuration: "42",
        }),
        204,
        "the call's completed status was accepted",
      );

      // 7. the inbox shows the thread unread, and opening it shows both texts and the call
      await page.reload();
      const thread = page.locator(
        `[data-cy='comms-thread'][data-peer='${PEER}']`,
      );
      await thread.waitFor();
      expect.eq(
        await thread.getAttribute("data-unread"),
        "1",
        "the reply left the thread unread",
      );
      await clickUntil(
        page,
        `[data-cy='comms-thread'][data-peer='${PEER}']`,
        async () => await page.locator("[data-cy='comms-msg']").count() === 2,
      );
      expect.eq(
        await page.locator("[data-cy='comms-msg']").evaluateAll((els) =>
          els.map((e) =>
            `${e.getAttribute("data-direction")}:${
              e.getAttribute("data-status")
            }`
          ).join(" | ")
        ),
        "outbound:delivered | inbound:received",
        "the thread: our text (delivered), then theirs",
      );
      await expect.see("Got it, thanks!");
      expect(
        await page.locator("[data-cy='comms-tl-call']").count() === 1,
        "the call sits in the thread's timeline",
      );
      await page.locator(`[data-cy='comms-thread'][data-peer='${PEER}']`)
        .waitFor();
      expect.eq(
        await page.locator("[data-cy='comms-unread']").count(),
        0,
        "opening the thread read it",
      );

      // 8. the Calls tab: the call, and its transcript + voicemail (REQ-916b)
      await page.locator("[data-cy='comms-tab-calls']").click();
      const row = page.locator(
        `[data-cy='comms-call-row'][data-id='${callId}']`,
      );
      await row.waitFor();
      const rowText = (await row.textContent()) ?? "";
      for (const s of ["Incoming", "(512) 555-9876", "Completed", "0:42"]) {
        expect(rowText.includes(s), `the call row shows ${s}`);
      }
      await row.click();
      await page.locator("[data-cy='comms-call-detail']").waitFor();
      await page.locator("[data-cy='comms-transcript']").waitFor();
      await expect.see("Hi, I need a cleaning quote");
      expect.eq(
        await page.locator("[data-cy='comms-recording']").getAttribute("src"),
        `${twilioBase}/recordings/REphone`,
        "the voicemail player plays the recording",
      );

      // 9. release: confirm → the shop again; the stand-in freed the number and closed the subaccount
      page.once("dialog", (d) => d.accept());
      await page.locator("[data-cy='comms-release']").click();
      await page.locator("[data-cy='comms-page'][data-mode='shop']").waitFor({
        timeout: 30_000,
      });
      expect.eq(
        seen.slice(-2).map((c) => `${c.method} ${c.path}`).join(" | "),
        [
          `DELETE /2010-04-01/Accounts/${SUB_SID}/IncomingPhoneNumbers/PNsubPhone.json`,
          `POST /2010-04-01/Accounts/${SUB_SID}.json`,
        ].join(" | "),
        "release freed the number and closed the subaccount",
      );
    } finally {
      await twilio.shutdown();
    }
  }));
