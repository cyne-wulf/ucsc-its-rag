import crypto from "node:crypto";

export function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hashId(parts: (string | number)[]) {
  return sha256(parts.join(":"));
}

export function hashToUuid(hash: string) {
  const clean = hash.replace(/[^a-fA-F0-9]/g, "").padEnd(32, "0").slice(0, 32);
  return [
    clean.slice(0, 8),
    clean.slice(8, 12),
    clean.slice(12, 16),
    clean.slice(16, 20),
    clean.slice(20, 32),
  ].join("-");
}
