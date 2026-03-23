import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

type JsonLike =
  | string
  | number
  | boolean
  | null
  | JsonLike[]
  | { [key: string]: JsonLike };

export type EncryptedCredentialEnvelope = {
  __encrypted: true;
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
};

function requireKeyBuffer(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is required for credential operations");
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), "base64");
  } catch {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must be base64-encoded");
  }
  if (key.length !== 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return key;
}

export function isEncryptedCredentialEnvelope(
  value: unknown
): value is EncryptedCredentialEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const input = value as Record<string, unknown>;
  return (
    input.__encrypted === true &&
    input.version === 1 &&
    input.algorithm === "aes-256-gcm" &&
    typeof input.iv === "string" &&
    typeof input.tag === "string" &&
    typeof input.ciphertext === "string"
  );
}

export function encryptCredentialPayload(payload: JsonLike): EncryptedCredentialEnvelope {
  const key = requireKeyBuffer();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf-8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    __encrypted: true,
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptCredentialPayload(value: unknown): JsonLike {
  if (!isEncryptedCredentialEnvelope(value)) {
    throw new Error("Credential payload is not an encrypted envelope");
  }
  const key = requireKeyBuffer();
  const iv = Buffer.from(value.iv, "base64");
  const tag = Buffer.from(value.tag, "base64");
  const ciphertext = Buffer.from(value.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf-8")) as JsonLike;
}

export function unwrapCredentialPayload(value: unknown): JsonLike {
  if (isEncryptedCredentialEnvelope(value)) {
    return decryptCredentialPayload(value);
  }
  return (value ?? null) as JsonLike;
}
