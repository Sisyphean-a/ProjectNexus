import { describe, expect, it } from "vitest";
import sampleIndex from "../fixtures/sample-index-v2.json";
import { createIndex } from "../factories/createIndex";

describe("factory + fixture integration", () => {
  it("fixture 与工厂生成的索引结构兼容", () => {
    const generated = createIndex();

    expect(sampleIndex.version).toBe(2);
    expect(sampleIndex.categories[0].id).toBeTypeOf("string");
    expect(generated.categories[0].items[0].storage?.gistId).toBeTruthy();
  });
});
