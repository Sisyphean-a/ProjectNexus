import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createConfig } from "../../../../tests/factories/createConfig";
import {
  createCategory,
  createIndex,
  createIndexItem,
} from "../../../../tests/factories/createIndex";

const mocks = vi.hoisted(() => ({
  workspaceFacade: {
    initWorkspace: vi.fn(),
    initializeGist: vi.fn(),
    addCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    addFile: vi.fn(),
    updateFile: vi.fn(),
    deleteFile: vi.fn(),
    changeFileLanguage: vi.fn(),
    getFileLanguage: vi.fn(),
  },
  syncFacade: {
    getRateLimit: vi.fn(() => ({
      limit: 5000,
      remaining: 5000,
      resetAt: 0,
    })),
  },
  historyFacade: {
    deleteFileHistory: vi.fn(),
  },
  vaultFacade: {
    hasPassword: vi.fn(() => true),
    getFileContent: vi.fn(),
  },
}));

vi.mock("../../../bootstrap/container", () => ({
  appContainer: mocks,
}));

import { useSelectionStore } from "../useSelectionStore";
import { useWorkspaceStore } from "../useWorkspaceStore";

describe("useWorkspaceStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("init 会加载 workspace 并默认选中首分类", async () => {
    mocks.workspaceFacade.initWorkspace.mockResolvedValue({
      config: createConfig(),
      index: createIndex({
        categories: [
          createCategory({ id: "cat-a", items: [] }),
          createCategory({ id: "cat-b", items: [] }),
        ],
      }),
      shouldResetSecureCache: false,
    });

    const workspaceStore = useWorkspaceStore();
    const selectionStore = useSelectionStore();

    await workspaceStore.init();

    expect(workspaceStore.index?.categories.map((item) => item.id)).toEqual([
      "cat-a",
      "cat-b",
    ]);
    expect(selectionStore.selectedCategoryId).toBe("cat-a");
    expect(selectionStore.selectedFileId).toBe(null);
  });

  it("addFile 会更新远端时间并选中新文件", async () => {
    const workspaceStore = useWorkspaceStore();
    const selectionStore = useSelectionStore();
    workspaceStore.config = createConfig();
    workspaceStore.index = createIndex({
      categories: [createCategory({ id: "cat-a", items: [] })],
    });
    selectionStore.selectedCategoryId = "cat-a";

    mocks.workspaceFacade.addFile.mockResolvedValue({
      file: {
        id: "file-1",
        title: "File 1",
        filename: "file-1.yaml",
        language: "yaml",
        tags: [],
      },
      newRemoteTime: "2026-02-01T00:00:00.000Z",
    });

    const result = await workspaceStore.addFile("cat-a", "File 1");

    expect(mocks.workspaceFacade.addFile).toHaveBeenCalledWith(
      expect.objectContaining({
        config: workspaceStore.config,
        index: workspaceStore.index,
      }),
      "cat-a",
      "File 1",
      "yaml",
      "",
    );
    expect(result).toEqual({
      id: "file-1",
      title: "File 1",
      gist_file: "file-1.yaml",
      language: "yaml",
      tags: [],
    });
    expect(selectionStore.selectedFileId).toBe("file-1");
    expect(workspaceStore.remoteUpdatedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("currentCategory 和 currentFileList 基于 selection store 计算", async () => {
    const workspaceStore = useWorkspaceStore();
    const selectionStore = useSelectionStore();
    workspaceStore.index = createIndex({
      categories: [
        createCategory({
          id: "cat-a",
          items: [createIndexItem({ id: "file-a" })],
        }),
      ],
    });
    selectionStore.selectedCategoryId = "cat-a";

    expect(workspaceStore.currentCategory?.id).toBe("cat-a");
    expect(workspaceStore.currentFileList.map((item) => item.id)).toEqual([
      "file-a",
    ]);
  });
});
