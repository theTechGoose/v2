/**
 * REQ-900/901 — TwiML builders. Pure string assembly; every text and
 * attribute goes through escapeXml so a caller's name or a URL with `&`
 * can never break the document Twilio parses.
 */

const XML = '<?xml version="1.0" encoding="UTF-8"?>';

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function attrs(
  a: Record<string, string | number | boolean | undefined>,
): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join("");
}

function response(inner: string): string {
  return `${XML}<Response>${inner}</Response>`;
}

export function emptyResponse(): string {
  return response("");
}

export function hangup(): string {
  return response("<Hangup/>");
}

export function say(text: string, language?: string): string {
  return `<Say${attrs({ language })}>${escapeXml(text)}</Say>`;
}

/** the softphone dialed a PSTN number: bridge it, showing the line as caller id */
export function dialNumber(
  p: {
    callerId: string;
    to: string;
    statusCallback: string;
    record?: boolean;
    recordingStatusCallback?: string;
  },
): string {
  const dial = attrs({
    callerId: p.callerId,
    record: p.record ? "record-from-answer-dual" : undefined,
    recordingStatusCallback: p.record ? p.recordingStatusCallback : undefined,
  });
  const num = attrs({
    statusCallback: p.statusCallback,
    statusCallbackEvent: "initiated ringing answered completed",
  });
  return response(
    `<Dial${dial}><Number${num}>${escapeXml(p.to)}</Number></Dial>`,
  );
}

/** the line was called: ring every signed-in softphone, then hand the result to `action` */
export function ringClients(
  p: {
    identities: string[];
    timeoutSec: number;
    action: string;
    callerId?: string;
  },
): string {
  const clients = p.identities.map((id) => `<Client>${escapeXml(id)}</Client>`)
    .join("");
  return response(
    `<Dial${
      attrs({ timeout: p.timeoutSec, action: p.action, callerId: p.callerId })
    }>${clients}</Dial>`,
  );
}

/** voicemail */
export function record(
  p: {
    sayFirst: string;
    maxLengthSec: number;
    recordingStatusCallback: string;
    language?: string;
  },
): string {
  return response(
    say(p.sayFirst, p.language) +
      `<Record${
        attrs({
          maxLength: p.maxLengthSec,
          playBeep: "true",
          recordingStatusCallback: p.recordingStatusCallback,
        })
      }/>`,
  );
}

/** the AI receptionist: hand the audio to ConversationRelay, which talks to our websocket */
export function connectRelay(p: {
  url: string;
  action: string;
  welcomeGreeting: string;
  language?: string;
  parameters?: Record<string, string>;
}): string {
  const params = Object.entries(p.parameters ?? {}).map(([name, value]) =>
    `<Parameter${attrs({ name, value })}/>`
  ).join("");
  return response(
    `<Connect${attrs({ action: p.action })}>` +
      `<ConversationRelay${
        attrs({
          url: p.url,
          welcomeGreeting: p.welcomeGreeting,
          language: p.language ?? "en-US",
          interruptible: "any",
          dtmfDetection: "true",
        })
      }>` +
      params +
      `</ConversationRelay></Connect>`,
  );
}

/** forward the call to a real phone */
export function forwardTo(
  p: { number: string; callerId: string; action?: string },
): string {
  return response(
    `<Dial${attrs({ callerId: p.callerId, action: p.action })}><Number>${
      escapeXml(p.number)
    }</Number></Dial>`,
  );
}
