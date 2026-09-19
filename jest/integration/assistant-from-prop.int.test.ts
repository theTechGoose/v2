/**
 * REQ-007 — NW-06 (PDF p5): "Make sure the 'From' block includes email and
 * website when the Dragon has provided them. (Screenshot shows only name and
 * phone.)"
 *
 * The bug: routes/assistant/index.tsx mounted <AsstChat> WITHOUT the `from`
 * prop (routes/assistant/[threadId].tsx passes it), so a conversation started
 * at the bare /assistant route — the chat path stays on that island via
 * history.replaceState — dropped the whole From block on the review card.
 *
 * Fresh serializes island props into the page; this pins that the AsstChat
 * island on /assistant carries `from` (and the contractor's email string).
 */
import { type ApiSession, contractor } from "./helpers/api";

const FE = process.env.FRONTEND_BASE_URL ?? "http://localhost:5280";
const EMAIL = "from.prop.jest@blackhole.postmarkapp.com";

async function ssr(s: ApiSession, path: string) {
  const res = await fetch(`${FE}${path}`, {
    headers: { cookie: s.cookieHeaderValue() },
    redirect: "manual",
  });
  return { status: res.status, html: await res.text() };
}

/** The serialized props object of the AsstChat island (the one carrying
 *  `userInitials`) inside Fresh's boot() payload — keys are \"-escaped. */
function asstChatProps(html: string): string | undefined {
  return /\{(?=[^{}]*\\"userInitials\\")[^{}]*\}/.exec(html)?.[0];
}

describe("REQ-007 NW-06 /assistant mounts AsstChat with the From block", () => {
  let s: ApiSession;

  beforeAll(async () => {
    s = await contractor("+15125550934");
    const me = await s.put("/me", {
      name: "From Prop Contractor",
      email: EMAIL,
      language: "en",
    });
    expect(me.status).toBeLessThan(400);
  });

  it("REQ-007 NW-06 the bare /assistant route passes `from` (with the contractor's email)", async () => {
    const { status, html } = await ssr(s, "/assistant");
    expect(status).toBe(200);
    const props = asstChatProps(html);
    expect(props).toBeTruthy();
    expect(props).toMatch(/\\"from\\":\d+/);
    expect(html).toContain(EMAIL);
  });

  it("control: /assistant/<threadId> already passes `from`", async () => {
    const conv = await s.post("/agents/conversations", {});
    const id = conv.body?.id ?? conv.body?.conversation?.id;
    expect(id).toBeTruthy();
    const { status, html } = await ssr(s, `/assistant/${id}`);
    expect(status).toBe(200);
    expect(asstChatProps(html)).toMatch(/\\"from\\":\d+/);
    expect(html).toContain(EMAIL);
  });
});
