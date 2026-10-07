// Content hash and the options hash the helper cache keys on.
// optionsHash is SHA-256 of the canonical JSON of options with `scope` removed.

function bytesOf(input) {
  if (input == null) return new Uint8Array();
  if (typeof input === "string") return new TextEncoder().encode(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError("sha256Hex expects bytes");
}

export async function sha256Hex(bytes) {
  const view = bytesOf(bytes);
  const digest = await crypto.subtle.digest("SHA-256", view);
  const hex = [];
  for (const byte of new Uint8Array(digest)) hex.push(byte.toString(16).padStart(2, "0"));
  return hex.join("");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

// Top-level `scope` is omitted. Key order does not change the hash.
export function canonicalOptions(options) {
  const src = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const copy = {};
  for (const key of Object.keys(src).sort()) {
    if (key === "scope") continue;
    copy[key] = canonicalize(src[key]);
  }
  return copy;
}

export function canonicalOptionsJson(options) {
  return JSON.stringify(canonicalOptions(options));
}

export async function optionsHash(options) {
  return sha256Hex(canonicalOptionsJson(options));
}
