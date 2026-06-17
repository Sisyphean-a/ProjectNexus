import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive } from "vue";
import { useEditorSession } from "../useEditorSession";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createBaseContext() {
  const selectionStore = reactive({ selectedFileId: "file-1" });
  const workspaceStore = reactive({
    currentGistId: "root-1",
    currentFileList: [
      { id: "file-1", title: "A", gist_file: "a.yaml", isSecure: false },
      { id: "file-2", title: "B", gist_file: "b.json", isSecure: false },
    ],
    remoteUpdatedAt: null as string | null,
    getFileLanguage: vi.fn().mockResolvedValue("yaml"),
    changeFileLanguage: vi.fn().mockResolvedValue(true),
    saveFileContent: vi.fn().mockResolvedValue(undefined),
  });
  const vaultStore = {
    getFileContent: vi.fn().mockResolvedValue("initial"),
    hasPassword: vi.fn(() => true),
    updateFileSecureStatus: vi.fn().mockResolvedValue(undefined),
  };
  const historyStore = {
    recordAutoSnapshot: vi.fn().mockResolvedValue(undefined),
    recordManualSnapshot: vi.fn().mockResolvedValue(undefined),
  };
  const message = {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(() => ({ destroy: vi.fn() })),
  };
  const dialog = { warning: vi.fn() };

  return {
    selectionStore,
    workspaceStore,
    vaultStore,
    historyStore,
    message,
    dialog,
  };
}

describe("useEditorSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("快速切换文件时忽略过期加载结果", async () => {
    const firstLoad = deferred<string>();
    const secondLoad = deferred<string>();
    const firstLanguage = deferred<string>();
    const secondLanguage = deferred<string>();
    const context = createBaseContext();

    context.vaultStore.getFileContent
      .mockImplementationOnce(() => firstLoad.promise)
      .mockImplementationOnce(() => secondLoad.promise);
    context.workspaceStore.getFileLanguage
      .mockImplementationOnce(() => firstLanguage.promise)
      .mockImplementationOnce(() => secondLanguage.promise);

    const scope = effectScope();
    const session = scope.run(() => useEditorSession(context))!;

    await nextTick();
    context.selectionStore.selectedFileId = "file-2";
    await nextTick();

    secondLoad.resolve("second-content");
    secondLanguage.resolve("json");
    await Promise.resolve();
    await nextTick();

    firstLoad.resolve("first-content");
    firstLanguage.resolve("yaml");
    await Promise.resolve();
    await nextTick();

    expect(session.code.value).toBe("second-content");
    expect(session.language.value).toBe("json");

    scope.stop();
  });

  it("restoreVersion 会立即覆盖内容并标记为脏", async () => {
    const context = createBaseContext();
    const scope = effectScope();
    const session = scope.run(() => useEditorSession(context))!;

    await Promise.resolve();
    await nextTick();

    session.handleRestoreVersion("restored-content");

    expect(session.code.value).toBe("restored-content");
    expect(session.isDirty.value).toBe(true);

    scope.stop();
  });
});
