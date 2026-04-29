/**
 * Lifecycle of an audio file's transcription:
 *   pending → ready  on success
 *           → failed on error (with reason on the FileRecord)
 *
 * Set to "pending" by the upload handler when mimeType startsWith "audio/";
 * a fire-and-forget coordinator transitions it. GETs may return the file
 * before the transition lands — clients should poll until !== "pending".
 */
export type TranscriptStatus = "pending" | "ready" | "failed";

/**
 * Stored file metadata. Bytes live separately under page keys; this DTO
 * is what the controller returns from list/get-meta endpoints.
 */
export interface FileRecord {
  id: string;
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Number of 60KiB pages the bytes were split across. */
  pageCount: number;
  /** SHA-256 of the original bytes, hex-encoded. */
  sha256: string;
  createdAt: string;
  /** Set only for audio uploads. */
  transcriptStatus?: TranscriptStatus;
  /** Plain-text transcript when transcriptStatus === "ready". */
  transcript?: string;
  /** Reason string when transcriptStatus === "failed". */
  transcriptError?: string;
}
