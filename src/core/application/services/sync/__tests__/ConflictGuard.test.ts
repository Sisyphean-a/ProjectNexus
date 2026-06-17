import { describe, expect, it, vi } from "vitest";
import { ConflictGuard } from "../ConflictGuard";

function createRepo() {
  return {
    fetchGist: vi.fn(),
  };
}

describe("ConflictGuard", () => {
  it("在远端时间更新时抛出同步冲突", async () => {
    const gistRepo = createRepo();
    gistRepo.fetchGist.mockResolvedValue({
      updated_at: "2026-03-01T00:00:00.000Z",
    });
    const guard = new ConflictGuard(gistRepo as any);

    await expect(
      guard.assertCanPush("root-1", "2026-01-01T00:00:00.000Z"),
    ).rejects.toThrow("同步冲突");
  });

  it("在无法确认远端状态时显式失败", async () => {
    const gistRepo = createRepo();
    gistRepo.fetchGist.mockRejectedValue(new Error("network down"));
    const guard = new ConflictGuard(gistRepo as any);

    await expect(
      guard.assertCanPush("root-1", "2026-01-01T00:00:00.000Z"),
    ).rejects.toThrow("无法确认远端最新状态");
  });
});
