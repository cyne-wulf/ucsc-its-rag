import crypto from "node:crypto";

export function hashString(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hashObject(input: unknown) {
  return hashString(JSON.stringify(input));
}
