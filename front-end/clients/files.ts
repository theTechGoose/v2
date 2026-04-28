/**
 * HTTP client for the backend's `/files` blob store.
 *
 * The backend accepts JSON-only uploads (no multipart parser dep), so we
 * base64-encode the bytes browser-side and POST. Returns the FileRecord
 * the backend persists, including the generated id used by other modules
 * (e.g. agents/chat passes payload.fileId for voice transcription).
 */
import { api, type ApiOptions } from "../lib/api.ts";

export interface FileRecord {
  id: string;
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  sha256: string;
  createdAt: string;
}

/**
 * Convert a Blob (e.g. from MediaRecorder) into a base64 string with the
 * data-URI prefix stripped. Uses FileReader so we don't have to chunk
 * through atob/btoa for large clips.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const reader = new FileReader();
  return await new Promise((resolve, reject) => {
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:<mime>;base64,XXXX" — strip prefix.
      const i = result.indexOf(",");
      resolve(i >= 0 ? result.slice(i + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("blob read failed"));
    reader.readAsDataURL(blob);
  });
}

export const filesClient = {
  async uploadBlob(blob: Blob, filename: string, opts: ApiOptions = {}): Promise<FileRecord> {
    const base64 = await blobToBase64(blob);
    return await api.post<FileRecord>("/files", {
      filename,
      mimeType: blob.type || "application/octet-stream",
      base64,
    }, opts);
  },
};
