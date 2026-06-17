import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  historyFacade: {
    getFileHistory: vi.fn(),
    importRemoteHistory: vi.fn(),
    recordAutoSnapshot: vi.fn(),
    recordRestoreSnapshot: vi.fn(),
  },
}));

vi.mock("../../../bootstrap/container", () => ({
  appContainer: mocks,
}));

import { useHistoryStore } from "../useHistoryStore";

describe("useHistoryStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("getFileHistory 透传 facade 结果", async () => {
    const historyStore = useHistoryStore();
    mocks.historyFacade.getFileHistory.mockResolvedValue([{ id: 1 }]);

    await expect(historyStore.getFileHistory("file-1")).resolves.toEqual([
      { id: 1 },
    ]);
    expect(mocks.historyFacade.getFileHistory).toHaveBeenCalledWith("file-1");
  });

  it("recordAutoSnapshot 在 facade 抛错时不中断", async () => {
    const historyStore = useHistoryStore();
    mocks.historyFacade.recordAutoSnapshot.mockRejectedValue(
      new Error("history failure"),
    );

    await expect(
      historyStore.recordAutoSnapshot("file-1", "content"),
    ).resolves.toBeUndefined();
  });
});
