// Deterministic Roam block uids for the PhD stress build. Same salt + key -> same uid, so a re-run finds what it
// already wrote. A new salt (after cleanup) gives a fresh set: Roam never sees a deleted uid again.
import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export const UID_LEN = 9;
export const UID_RE = /^[A-Za-z0-9_-]{9}$/;

export function uidFor(salt, key) {
  const digest = createHash("sha256").update(`${salt}\0${key}`).digest();
  let out = "";
  for (let i = 0; i < UID_LEN; i += 1) out += ALPHABET[digest[i] & 63];
  return out;
}

export function newSalt() {
  return randomBytes(6).toString("hex");
}

// key -> uid for every key, failing loudly on a collision (two keys, one uid).
export function uidMap(salt, keys) {
  const byKey = new Map();
  const byUid = new Map();
  for (const key of keys) {
    if (byKey.has(key)) continue;
    const uid = uidFor(salt, key);
    const other = byUid.get(uid);
    if (other !== undefined && other !== key) throw new Error(`uid collision: ${key} and ${other} -> ${uid}`);
    byKey.set(key, uid);
    byUid.set(uid, key);
  }
  return byKey;
}
