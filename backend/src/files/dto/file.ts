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
}
