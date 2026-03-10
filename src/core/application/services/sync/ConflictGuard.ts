import type { IGistRepository } from "../../ports/IGistRepository";

export class ConflictGuard {
  constructor(private readonly gistRepo: Pick<IGistRepository, "fetchGist">) {}

  async assertCanPush(
    gistId: string,
    lastKnownRemoteTime: string | null,
  ): Promise<void> {
    try {
      const meta = await this.gistRepo.fetchGist(gistId);
      const remoteTime = new Date(meta.updated_at).getTime();
      const localTime = lastKnownRemoteTime
        ? new Date(lastKnownRemoteTime).getTime()
        : 0;

      if (remoteTime > localTime) {
        throw new Error("检测到同步冲突！远程数据已被其他设备更新。");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("同步冲突")) {
        throw error;
      }

      throw new Error("无法确认远端最新状态，已中止写入。", {
        cause: error,
      });
    }
  }
}
