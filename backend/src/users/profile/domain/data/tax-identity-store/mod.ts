import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import type { TaxIdentity, UpdateTaxIdentityDto } from "@profile/dto/tax-identity.ts";

const PREFIX = "profile_tax";

/**
 * TaxIdentityStore — owns the W-9 file-id pointer + the TIN-hash blob.
 *
 * Raw TIN never lands in storage. The `update()` flow accepts a plain
 * `tin` field and computes:
 *   - tinSalt    : per-write 32-byte hex
 *   - tinHashed  : sha256(salt + tin)
 *   - tinMasked  : "***-**-1234" for display
 *
 * Verification (a customer typing their TIN to download the W-9) calls
 * `verifyTin(userId, plain)` which re-hashes with the stored salt and
 * compares. No equality on the raw value.
 */
@Injectable()
export class TaxIdentityStore {
  async get(userId: string): Promise<TaxIdentity | null> {
    const kv = await getKv();
    const r = await kv.get<TaxIdentity>([PREFIX, userId]);
    return r.value ?? null;
  }

  async update(userId: string, patch: UpdateTaxIdentityDto): Promise<TaxIdentity> {
    const existing = await this.get(userId);
    const now = new Date().toISOString();

    let next: TaxIdentity = existing
      ? { ...existing, userId, updatedAt: now }
      : { userId, createdAt: now, updatedAt: now };

    if (patch.w9FileId !== undefined) {
      next = { ...next, w9FileId: patch.w9FileId, w9UploadedAt: now };
    }
    if (patch.tin !== undefined && patch.tin !== "") {
      const salt = generateSaltHex();
      const hashed = await hashSha256Hex(salt + patch.tin);
      next = { ...next, tinSalt: salt, tinHashed: hashed, tinMasked: maskTin(patch.tin) };
    }

    const kv = await getKv();
    await kv.set([PREFIX, userId], next);
    return next;
  }

  async verifyTin(userId: string, plain: string): Promise<boolean> {
    const existing = await this.get(userId);
    if (!existing?.tinHashed || !existing.tinSalt) return false;
    const candidate = await hashSha256Hex(existing.tinSalt + plain);
    return constantTimeEquals(candidate, existing.tinHashed);
  }

  async deleteW9(userId: string): Promise<TaxIdentity | null> {
    const existing = await this.get(userId);
    if (!existing) return null;
    const updated: TaxIdentity = { ...existing, w9FileId: undefined, w9UploadedAt: undefined, updatedAt: new Date().toISOString() };
    const kv = await getKv();
    await kv.set([PREFIX, userId], updated);
    return updated;
  }
}

// --- helpers ---

function generateSaltHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashSha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function maskTin(tin: string): string {
  const digits = tin.replace(/\D/g, "");
  if (digits.length < 4) return "***-**-****";
  return `***-**-${digits.slice(-4)}`;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
