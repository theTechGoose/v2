/**
 * Pure rule for whether a file's MIME type identifies it as audio.
 *
 * Used by the upload pipeline to decide whether to queue a transcription
 * job. Lives as a business helper so the rule is testable in isolation
 * and any other call site (future "voice memo gallery", agent attachment
 * preview) can ask the same question without re-implementing it.
 */
export function isAudioMime(mimeType: string | undefined | null): boolean {
  if (!mimeType) return false;
  const normalized = mimeType.toLowerCase().trim();
  return normalized.startsWith("audio/");
}
