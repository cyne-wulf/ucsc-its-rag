import { describe, expect, it } from "vitest";
import { normalizeQuery } from "@/lib/normalize";

describe("normalizeQuery", () => {
  it("lowercases text and collapses whitespace", () => {
    expect(normalizeQuery("  Reset   Password ")).toBe("reset password");
  });
});
