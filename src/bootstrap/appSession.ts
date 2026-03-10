import { computed, ref } from "vue";

export type StartupSyncState = "idle" | "scheduled" | "running" | "failed";

interface ThemeSessionPort {
  init(): Promise<void>;
}

interface AuthSessionPort {
  isAuthenticated: boolean;
  tokenStatus: "unknown" | "valid" | "invalid";
  init(): Promise<void>;
  verifyTokenInBackground(force?: boolean): Promise<void>;
}

interface WorkspaceSessionPort {
  init(): Promise<void>;
  syncIfStale(maxStaleMs?: number): Promise<boolean>;
}

type TimerHandle = ReturnType<typeof setTimeout> | number;

type ScheduleFn = (
  callback: () => Promise<void> | void,
  delay: number,
) => TimerHandle;

type ClearScheduleFn = (timer: TimerHandle) => void;

interface AppSessionOptions {
  theme: ThemeSessionPort;
  auth: AuthSessionPort;
  workspace: WorkspaceSessionPort;
  startupSyncDelayMs?: number;
  startupSyncStaleMs?: number;
  setTimeoutFn?: ScheduleFn;
  clearTimeoutFn?: ClearScheduleFn;
}

const DEFAULT_STARTUP_SYNC_DELAY_MS = 3000;
const DEFAULT_STARTUP_SYNC_STALE_MS = 5 * 60 * 1000;
const FAILED_STATUS_CLASS =
  "border-amber-300/60 bg-amber-50/95 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200";
const DEFAULT_STATUS_CLASS =
  "border-slate-200/80 bg-white/95 text-slate-600 dark:border-slate-700/80 dark:bg-slate-900/85 dark:text-slate-300";

export function createAppSession(options: AppSessionOptions) {
  const startupSyncState = ref<StartupSyncState>("idle");
  const hasBootstrappedWorkspace = ref(false);

  let startupSyncTimer: TimerHandle | null = null;

  const startupSyncDelayMs =
    options.startupSyncDelayMs ?? DEFAULT_STARTUP_SYNC_DELAY_MS;
  const startupSyncStaleMs =
    options.startupSyncStaleMs ?? DEFAULT_STARTUP_SYNC_STALE_MS;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;

  function clearStartupSyncTimer() {
    if (startupSyncTimer !== null) {
      clearTimeoutFn(startupSyncTimer);
      startupSyncTimer = null;
    }
  }

  function scheduleStartupSync() {
    if (!options.auth.isAuthenticated) {
      return;
    }

    clearStartupSyncTimer();
    startupSyncState.value = "scheduled";

    startupSyncTimer = setTimeoutFn(async () => {
      startupSyncState.value = "running";

      try {
        await options.workspace.syncIfStale(startupSyncStaleMs);
        startupSyncState.value = "idle";
      } catch (error) {
        console.error("[App] Startup sync failed", error);
        startupSyncState.value = "failed";
      }
    }, startupSyncDelayMs);
  }

  async function bootstrapWorkspaceForSession() {
    if (!options.auth.isAuthenticated || hasBootstrappedWorkspace.value) {
      return;
    }

    hasBootstrappedWorkspace.value = true;

    try {
      await options.workspace.init();
      scheduleStartupSync();
      void options.auth.verifyTokenInBackground().catch((error) => {
        console.error("[App] Background token verification failed", error);
      });
    } catch (error) {
      hasBootstrappedWorkspace.value = false;
      throw error;
    }
  }

  async function bootstrap() {
    await Promise.all([options.theme.init(), options.auth.init()]);
    await bootstrapWorkspaceForSession();
  }

  async function handleAuthChange(authed: boolean) {
    if (authed) {
      await bootstrapWorkspaceForSession();
      return;
    }

    clearStartupSyncTimer();
    startupSyncState.value = "idle";
    hasBootstrappedWorkspace.value = false;
  }

  const showStartupStatus = computed(() => {
    if (!options.auth.isAuthenticated) {
      return false;
    }

    return (
      startupSyncState.value !== "idle" || options.auth.tokenStatus === "unknown"
    );
  });

  const startupStatusText = computed(() => {
    if (startupSyncState.value === "failed") {
      return "后台同步失败，可稍后手动重试";
    }
    if (startupSyncState.value === "running") {
      return "正在后台同步远程数据...";
    }
    if (startupSyncState.value === "scheduled") {
      return "已加载本地缓存，稍后自动同步...";
    }
    if (options.auth.tokenStatus === "unknown") {
      return "正在后台校验身份凭据...";
    }
    return "";
  });

  const startupStatusClass = computed(() => {
    if (startupSyncState.value === "failed") {
      return FAILED_STATUS_CLASS;
    }

    return DEFAULT_STATUS_CLASS;
  });

  function dispose() {
    clearStartupSyncTimer();
  }

  return {
    startupSyncState,
    showStartupStatus,
    startupStatusText,
    startupStatusClass,
    bootstrap,
    handleAuthChange,
    dispose,
  };
}
