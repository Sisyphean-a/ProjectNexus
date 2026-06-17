export type AppResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; cause?: unknown };
