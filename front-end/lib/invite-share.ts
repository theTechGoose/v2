/**
 * REQ-601 (demo-loop cycle 4, M12) — when a worker's welcome text or an
 * editor's invite text could not go out, the page hands the owner what the
 * text would have carried: the sign-in link and the very text (the server
 * builds both, so the shared words match the SMS), to copy and send yourself.
 */

export interface InviteShare {
  /** the sign-in address (/worker?lang=… for a worker, the app for an editor) */
  url: string;
  /** the SMS body, word for word */
  text: string;
}

/** the share block for an add/invite answer: null when the text went out, or the server sent nothing to share */
export function inviteShare(
  made: { texted?: boolean; signInUrl?: string; shareText?: string },
): InviteShare | null {
  if (made.texted === true) return null;
  if (!made.signInUrl || !made.shareText) return null;
  return { url: made.signInUrl, text: made.shareText };
}

/** copy the text; never throws — false when there is no clipboard or it refused (the text stays on the page) */
export async function copyShareText(
  text: string,
  writeText: ((text: string) => Promise<void>) | undefined =
    typeof navigator !== "undefined" && navigator.clipboard
      ? (s) => navigator.clipboard.writeText(s)
      : undefined,
): Promise<boolean> {
  if (!writeText) return false;
  try {
    await writeText(text);
    return true;
  } catch {
    return false;
  }
}
