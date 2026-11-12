/**
 * REQ-212 — secrets at rest (a business's Stripe secret key): AES-256-GCM under SECRETS_KEY
 * (32 bytes, base64 or hex). Off the real deploy a fixed dev key stands in so the gate's lanes
 * and a dev box need no env; on the real deploy the key is required (REQ-318's switch).
 * Sealed form: `v1.<iv b64>.<ciphertext b64>` — a fresh iv every time.
 */
import {
  type EnvReader,
  onRealDeploy,
} from "@core/business/real-deploy/mod.ts";

export class SecretsKeyMissing extends Error {}

const DEV_KEY_SEED = "documonster dev secrets key — never on the real deploy";

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeKey(raw: string): Uint8Array {
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      out[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  return unb64(raw);
}

/** The AES key: SECRETS_KEY when set (must be 32 bytes), the dev key off the real deploy. */
export async function secretsKey(
  env: EnvReader = Deno.env,
): Promise<CryptoKey> {
  const raw = env.get("SECRETS_KEY")?.trim();
  let bytes: Uint8Array;
  if (raw) {
    try {
      bytes = decodeKey(raw);
    } catch {
      throw new SecretsKeyMissing(
        "SECRETS_KEY must be 32 bytes, base64 or hex",
      );
    }
    if (bytes.length !== 32) {
      throw new SecretsKeyMissing(
        "SECRETS_KEY must be 32 bytes, base64 or hex",
      );
    }
  } else if (onRealDeploy(env)) {
    throw new SecretsKeyMissing("SECRETS_KEY is required on the real deploy");
  } else {
    bytes = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(DEV_KEY_SEED),
      ),
    );
  }
  return crypto.subtle.importKey(
    "raw",
    bytes as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealSecret(
  plain: string,
  key: CryptoKey,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plain),
    ),
  );
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function openSecret(
  sealed: string,
  key: CryptoKey,
): Promise<string> {
  const [v, ivB64, ctB64] = sealed.split(".");
  if (v !== "v1" || !ivB64 || !ctB64) {
    throw new Error("secret-box: not a sealed secret");
  }
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(ivB64) as BufferSource },
    key,
    unb64(ctB64) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}
