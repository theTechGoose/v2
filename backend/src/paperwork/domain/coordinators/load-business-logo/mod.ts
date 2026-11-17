/**
 * REQ-628 — the business's uploaded logo (Settings → POST /files → PUT
 * /profile/identity `logoFileId`) as bytes, for the PDFs its customers get.
 * Undefined when there is none, the file is gone, or it is not the owner's.
 */
import { Injectable } from "#danet/core";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import type { LogoBytes } from "@paperwork/domain/business/pdf-logo/mod.ts";

@Injectable()
export class LoadBusinessLogo {
  constructor(
    private identity: BusinessIdentityStore = new BusinessIdentityStore(),
    private files: FileStore = new FileStore(),
  ) {}

  async run(userId: string): Promise<LogoBytes | undefined> {
    try {
      const fileId = (await this.identity.get(userId))?.logoFileId;
      if (!fileId) return undefined;
      const meta = await this.files.getOwnedMeta(fileId, userId);
      const bytes = await this.files.readBytes(fileId);
      return { bytes, mimeType: meta.mimeType };
    } catch {
      return undefined;
    }
  }
}
