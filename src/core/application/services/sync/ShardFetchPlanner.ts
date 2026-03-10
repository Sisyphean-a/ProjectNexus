import type { IGistRepository } from "../../ports/IGistRepository";
import type { GistFile } from "../../../domain/entities/types";

async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  limit: number,
  worker: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }

  const results: TOutput[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

export class ShardFetchPlanner {
  constructor(private readonly gistRepo: Pick<IGistRepository, "fetchShardManifest" | "getGistFilesByNames">) {}

  fetchManifests(
    gistIds: readonly string[],
    concurrency: number,
  ): Promise<Array<{ gistId: string; manifest: import("../../../domain/entities/types").ShardManifest | null }>> {
    return mapWithConcurrency(gistIds, concurrency, async (gistId) => ({
      gistId,
      manifest: await this.gistRepo.fetchShardManifest(gistId),
    }));
  }

  fetchFilesByShard(
    requests: ReadonlyArray<{ gistId: string; filenames: readonly string[] }>,
    concurrency: number,
  ): Promise<Array<{ gistId: string; files: Record<string, GistFile> }>> {
    return mapWithConcurrency(requests, concurrency, async (request) => ({
      gistId: request.gistId,
      files: await this.gistRepo.getGistFilesByNames(request.gistId, [...request.filenames]),
    }));
  }
}
