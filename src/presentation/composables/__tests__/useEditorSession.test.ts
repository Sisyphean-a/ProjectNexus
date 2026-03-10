import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import {
  AUTO_SNAPSHOT_DELAY_MS,
  createEditorSession,
} from "../useEditorSession";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe("createEditorSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loadSelectedFile 会忽略过期请求结果", async () => {
    const contentA = deferred<string>();
    const contentB = deferred<string>();
    const languageA = deferred<string>();
    const languageB = deferred<string>();

    const session = createEditorSession({
      selectedFileId: ref<string | null>(null),
      remoteUpdatedAt: ref<string | null>(null),
      currentGistId: ref<string | null>("root-1"),
      getFileContent: vi.fn((fileId: string) =>
        fileId === "file-a" ? contentA.promise : contentB.promise,
      ),
      getFileLanguage: vi.fn((fileId: string) =>
        fileId === "file-a" ? languageA.promise : languageB.promise,
      ),
      changeFileLanguage: vi.fn(),
      saveFileContent: vi.fn(),
      recordAutoSnapshot: vi.fn(),
      recordManualSnapshot: vi.fn(),
      hasPassword: vi.fn(() => true),
      updateFileSecureStatus: vi.fn(),
    });

    const first = session.loadSelectedFile("file-a");
    const second = session.loadSelectedFile("file-b");

    contentA.resolve("old-content");
    languageA.resolve("yaml");
    await first;

    expect(session.code.value).toBe("");
    expect(session.language.value).toBe("yaml");

    contentB.resolve("new-content");
    languageB.resolve("json");
    await second;

    expect(session.code.value).toBe("new-content");
    expect(session.language.value).toBe("json");
    expect(session.isDirty.value).toBe(false);
  });

  it("在编辑内容后会按延迟记录自动快照", async () => {
    const recordAutoSnapshot = vi.fn().mockResolvedValue(undefined);
    const session = createEditorSession({
      selectedFileId: ref<string | null>("file-1"),
      remoteUpdatedAt: ref<string | null>(null),
      currentGistId: ref<string | null>("root-1"),
      getFileContent: vi.fn(),
      getFileLanguage: vi.fn(),
      changeFileLanguage: vi.fn(),
      saveFileContent: vi.fn(),
      recordAutoSnapshot,
      recordManualSnapshot: vi.fn(),
      hasPassword: vi.fn(() => true),
      updateFileSecureStatus: vi.fn(),
    });

    session.code.value = "edited";
    await nextTick();
    vi.advanceTimersByTime(AUTO_SNAPSHOT_DELAY_MS - 1);
    expect(recordAutoSnapshot).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await Promise.resolve();

    expect(recordAutoSnapshot).toHaveBeenCalledWith("file-1", "edited");
  });
});
