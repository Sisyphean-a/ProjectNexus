import { describe, expect, it } from "vitest";
import { calculateChecksum } from "../Hash";

describe("calculateChecksum", () => {
  it("相同输入返回相同 hash", () => {
    const a = calculateChecksum("nexus-content");
    const b = calculateChecksum("nexus-content");
    expect(a).toBe(b);
  });

  it("不同输入返回不同 hash", () => {
    const a = calculateChecksum("content-a");
    const b = calculateChecksum("content-b");
    expect(a).not.toBe(b);
  });
});
