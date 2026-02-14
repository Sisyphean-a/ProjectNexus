import type { IGistRepository } from "../ports/IGistRepository";
import type {
  GistIndexItem,
  NexusFileStorage,
  NexusIndex,
  ShardManifest,
} from "../../domain/entities/types";
import { calculateChecksum } from "../../domain/shared/Hash";
import { NexusFile } from "../../domain/entities/NexusFile";

type ManifestRepository = Pick<
  IGistRepository,
  "fetchShardManifest" | "updateShardManifest"
>;

export class ShardManifestService {
  constructor(private gistRepo: ManifestRepository) {}

  async upsert(
    index: NexusIndex,
    item: GistIndexItem,
    file: NexusFile,
    updatedAt: string,
  ): Promise<void> {
    if (!item.storage) return;

    const descriptor = (index.shards || []).find((s) => s.id === item.storage!.shardId);
    if (!descriptor) return;

    const manifest =
      (await this.gistRepo.fetchShardManifest(item.storage.gistId)) ||
      ({
        version: 1,
        shardId: item.storage.shardId,
        updated_at: new Date().toISOString(),
        files: [],
      } as ShardManifest);

    const newSize = this.byteLength(file.content);
    const existing = manifest.files.find((f) => f.fileId === item.id);

    if (existing) {
      descriptor.totalBytes = Math.max(
        0,
        descriptor.totalBytes - existing.size + newSize,
      );
      existing.filename = item.storage.gist_file;
      existing.checksum = calculateChecksum(file.content);
      existing.updated_at = updatedAt;
      existing.size = newSize;
      existing.isSecure = !!item.isSecure;
    } else {
      manifest.files.push({
        fileId: item.id,
        filename: item.storage.gist_file,
        checksum: calculateChecksum(file.content),
        updated_at: updatedAt,
        size: newSize,
        isSecure: !!item.isSecure,
      });
      descriptor.fileCount += 1;
      descriptor.totalBytes += newSize;
    }

    descriptor.updated_at = updatedAt;
    await this.gistRepo.updateShardManifest(item.storage.gistId, manifest);
  }

  async removeByItem(index: NexusIndex, item: GistIndexItem): Promise<void> {
    if (!item.storage) return;

    const descriptor = (index.shards || []).find((s) => s.id === item.storage!.shardId);
    if (!descriptor) return;

    const manifest = await this.gistRepo.fetchShardManifest(item.storage.gistId);
    if (!manifest) return;

    const target = manifest.files.find((f) => f.fileId === item.id);
    if (!target) return;

    manifest.files = manifest.files.filter((f) => f.fileId !== item.id);
    descriptor.fileCount = Math.max(0, descriptor.fileCount - 1);
    descriptor.totalBytes = Math.max(0, descriptor.totalBytes - target.size);
    descriptor.updated_at = new Date().toISOString();

    await this.gistRepo.updateShardManifest(item.storage.gistId, manifest);
  }

  async removeByStorage(
    index: NexusIndex,
    fileId: string,
    storage: NexusFileStorage,
  ): Promise<void> {
    const descriptor = (index.shards || []).find((s) => s.id === storage.shardId);
    if (!descriptor) return;

    const manifest = await this.gistRepo.fetchShardManifest(storage.gistId);
    if (!manifest) return;

    const target = manifest.files.find((f) => f.fileId === fileId);
    if (!target) return;

    manifest.files = manifest.files.filter((f) => f.fileId !== fileId);
    descriptor.fileCount = Math.max(0, descriptor.fileCount - 1);
    descriptor.totalBytes = Math.max(0, descriptor.totalBytes - target.size);
    descriptor.updated_at = new Date().toISOString();

    await this.gistRepo.updateShardManifest(storage.gistId, manifest);
  }

  private byteLength(content: string): number {
    return new TextEncoder().encode(content).length;
  }
}
