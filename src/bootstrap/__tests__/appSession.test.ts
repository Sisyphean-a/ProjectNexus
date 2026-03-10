import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAppSession } from "../appSession";

type MockTimer = {
  callback: () => Promise<void> | void;
  delay: number;
  id: number;
};

function createMocks(isAuthenticated = true) {
  const order: string[] = [];
  const timers: MockTimer[] = [];

  const theme = {
    init: vi.fn(async () => {
      order.push("theme.init");
    }),
  };

  const auth = {
    isAuthenticated,
    tokenStatus: "unknown" as "unknown" | "valid" | "invalid",
    init: vi.fn(async () => {
      order.push("auth.init");
    }),
    verifyTokenInBackground: vi.fn(async () => {
      order.push("auth.verify");
    }),
  };

  const workspace = {
    init: vi.fn(async () => {
      order.push("workspace.init");
    }),
    syncIfStale: vi.fn(async () => {
      order.push("workspace.syncIfStale");
      return true;
    }),
  };

  const setTimeoutFn = vi.fn((callback: () => Promise<void> | void, delay: number) => {
    const timer = {
      callback,
      delay,
      id: timers.length + 1,
    };
    timers.push(timer);
    return timer.id;
  });

  const clearTimeoutFn = vi.fn();

  return {
    order,
    timers,
    theme,
    auth,
    workspace,
    setTimeoutFn,
    clearTimeoutFn,
  };
}

describe("createAppSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("只暴露会话状态与编排方法，不携带表现层文案映射", () => {
    const mocks = createMocks(true);
    const session = createAppSession({
      theme: mocks.theme,
      auth: mocks.auth,
      workspace: mocks.workspace,
      setTimeoutFn: mocks.setTimeoutFn,
      clearTimeoutFn: mocks.clearTimeoutFn,
    });

    expect(session).toMatchObject({
      startupSyncState: expect.anything(),
      bootstrap: expect.any(Function),
      handleAuthChange: expect.any(Function),
      dispose: expect.any(Function),
    });
    expect("showStartupStatus" in session).toBe(false);
    expect("startupStatusText" in session).toBe(false);
    expect("startupStatusClass" in session).toBe(false);
  });

  it("bootstrap 会在 theme 和 auth 初始化完成后再初始化 workspace", async () => {
    const mocks = createMocks(true);
    const session = createAppSession({
      theme: mocks.theme,
      auth: mocks.auth,
      workspace: mocks.workspace,
      setTimeoutFn: mocks.setTimeoutFn,
      clearTimeoutFn: mocks.clearTimeoutFn,
    });

    await session.bootstrap();

    expect(mocks.theme.init).toHaveBeenCalledTimes(1);
    expect(mocks.auth.init).toHaveBeenCalledTimes(1);
    expect(mocks.workspace.init).toHaveBeenCalledTimes(1);
    expect(mocks.order.indexOf("workspace.init")).toBeGreaterThan(
      mocks.order.indexOf("theme.init"),
    );
    expect(mocks.order.indexOf("workspace.init")).toBeGreaterThan(
      mocks.order.indexOf("auth.init"),
    );
  });

  it("bootstrap 仅在已认证时安排后台同步", async () => {
    const authedMocks = createMocks(true);
    const authedSession = createAppSession({
      theme: authedMocks.theme,
      auth: authedMocks.auth,
      workspace: authedMocks.workspace,
      setTimeoutFn: authedMocks.setTimeoutFn,
      clearTimeoutFn: authedMocks.clearTimeoutFn,
      startupSyncDelayMs: 3000,
      startupSyncStaleMs: 1234,
    });

    await authedSession.bootstrap();

    expect(authedSession.startupSyncState.value).toBe("scheduled");
    expect(authedMocks.timers).toHaveLength(1);
    expect(authedMocks.timers[0].delay).toBe(3000);

    await authedMocks.timers[0].callback();

    expect(authedMocks.workspace.syncIfStale).toHaveBeenCalledWith(1234);
    expect(authedSession.startupSyncState.value).toBe("idle");

    const guestMocks = createMocks(false);
    const guestSession = createAppSession({
      theme: guestMocks.theme,
      auth: guestMocks.auth,
      workspace: guestMocks.workspace,
      setTimeoutFn: guestMocks.setTimeoutFn,
      clearTimeoutFn: guestMocks.clearTimeoutFn,
    });

    await guestSession.bootstrap();

    expect(guestMocks.workspace.init).not.toHaveBeenCalled();
    expect(guestMocks.timers).toHaveLength(0);
    expect(guestSession.startupSyncState.value).toBe("idle");
  });

  it("bootstrap 会在 workspace 初始化后触发后台 token 校验", async () => {
    const mocks = createMocks(true);
    const session = createAppSession({
      theme: mocks.theme,
      auth: mocks.auth,
      workspace: mocks.workspace,
      setTimeoutFn: mocks.setTimeoutFn,
      clearTimeoutFn: mocks.clearTimeoutFn,
    });

    await session.bootstrap();

    expect(mocks.auth.verifyTokenInBackground).toHaveBeenCalledTimes(1);
    expect(mocks.order.indexOf("auth.verify")).toBeGreaterThan(
      mocks.order.indexOf("workspace.init"),
    );
  });

  it("handleAuthChange(false) 和 dispose 会清理已调度的同步定时器", async () => {
    const mocks = createMocks(true);
    const session = createAppSession({
      theme: mocks.theme,
      auth: mocks.auth,
      workspace: mocks.workspace,
      setTimeoutFn: mocks.setTimeoutFn,
      clearTimeoutFn: mocks.clearTimeoutFn,
    });

    await session.bootstrap();
    await session.handleAuthChange(false);

    expect(mocks.clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(session.startupSyncState.value).toBe("idle");

    await session.bootstrap();
    session.dispose();

    expect(mocks.clearTimeoutFn).toHaveBeenCalledTimes(2);
  });
});
