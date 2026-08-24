import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1_024 * 1_024,
} as const;

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt-v1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [version, encodedSalt, encodedHash] = storedHash.split("$");
  if (version !== "scrypt-v1" || !encodedSalt || !encodedHash) return false;
  try {
    const salt = Buffer.from(encodedSalt, "base64url");
    const expected = Buffer.from(encodedHash, "base64url");
    if (salt.byteLength !== 16 || expected.byteLength !== KEY_LENGTH) return false;
    const supplied = scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
    return timingSafeEqual(expected, supplied);
  } catch {
    return false;
  }
}
