import { describe, expect, it } from "vitest";
import { NexusFile } from "../NexusFile";

describe("NexusFile", () => {
  it("filename 会根据语言扩展名动态生成", () => {
    const file = new NexusFile("id-1", "Title", "content", "yaml");
    expect(file.filename).toBe("id-1.yaml");
  });

  it("updateContent 在内容变化时更新 checksum 与 dirty 状态", () => {
    const file = new NexusFile("id-1", "Title", "old", "yaml");

    file.updateContent("new-content");

    expect(file.content).toBe("new-content");
    expect(file.isDirty).toBe(true);
    expect(file.checksum).toBeTruthy();
  });

  it("changeLanguage 在语言变化时会触发 dirty", () => {
    const file = new NexusFile("id-1", "Title", "content", "yaml");

    file.changeLanguage("json");

    expect(file.language).toBe("json");
    expect(file.filename).toBe("id-1.json");
    expect(file.isDirty).toBe(true);
  });

  it("markSynced 会重置 dirty 并写入远端时间", () => {
    const file = new NexusFile(
      "id-1",
      "Title",
      "content",
      "yaml",
      [],
      "2026-01-01T00:00:00.000Z",
      true,
    );

    file.markSynced("2026-01-02T00:00:00.000Z");

    expect(file.isDirty).toBe(false);
    expect(file.lastSyncedAt).toBe("2026-01-02T00:00:00.000Z");
  });
});
