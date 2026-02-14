import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  if (!globalThis.crypto?.subtle) {
    vi.stubGlobal("crypto", webcrypto);
  }

  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // ignore storage access errors in restrictive environments
  }

  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
