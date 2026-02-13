import { Octokit } from "octokit";
import { GistRepository } from "../src/infrastructure/github/GistRepository";
import type {
  GistIndexItem,
  NexusIndex,
  ShardDescriptor,
} from "../src/core/domain/entities/types";

const NEXUS_INDEX_V2_FILENAME = "nexus_index_v2.json";
const NEXUS_SHARDS_FILENAME = "nexus_shards.json";

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

function parseShards(raw: string | undefined): ShardDescriptor[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ShardDescriptor[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function inferPart(value: string | undefined): number {
  if (!value) return 1;
  const match = value.match(/part-(\d+)/i);
  if (!match) return 1;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function buildShardReadme(input: {
  shard: ShardDescriptor;
  linkedCount: number;
  manifestCount: number;
  totalBytes: number;
  orphanManifestEntries: number;
}): string {
  const { shard, linkedCount, manifestCount, totalBytes, orphanManifestEntries } = input;
  const summary = `[${shard.kind}] ${shard.categoryName || "N/A"} · Part ${shard.part} · Files ${linkedCount}/${manifestCount} · Orphans ${orphanManifestEntries} · Size ${formatBytes(totalBytes)}`;
  return `# Nexus Shard

${summary}

| Key | Value |
| --- | --- |
| Shard | ${shard.id} |
| Gist | ${shard.gistId} |
| Category | ${shard.categoryName || "N/A"} (${shard.categoryId || "N/A"}) |
| Updated | ${shard.updated_at} |
`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function buildShardDescription(shard: ShardDescriptor): string {
  if (shard.kind === "large") {
    return `Nexus Shard [large] Large Files #${shard.part}`;
  }
  return `Nexus Shard [category] ${shard.categoryName || shard.categoryId || "Unknown"} (${shard.categoryId || "N/A"}) #${shard.part}`;
}

function mergeShardDescriptor(base: ShardDescriptor, incoming: ShardDescriptor): ShardDescriptor {
  const keepKind = base.kind || incoming.kind;
  return {
    id: base.id || incoming.id,
    gistId: base.gistId || incoming.gistId,
    categoryId: base.categoryId || incoming.categoryId,
    categoryName: base.categoryName || incoming.categoryName,
    part: base.part || incoming.part || 1,
    kind: keepKind,
    fileCount: Math.max(base.fileCount || 0, incoming.fileCount || 0),
    totalBytes: Math.max(base.totalBytes || 0, incoming.totalBytes || 0),
    updated_at: base.updated_at || incoming.updated_at || new Date().toISOString(),
  };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("请设置 GITHUB_TOKEN 环境变量");
    process.exit(1);
  }

  const apply = envFlag("APPLY", false);
  const rewriteReadme = envFlag("REWRITE_README", true);
  const rewriteDescription = envFlag("REWRITE_DESCRIPTION", true);
  const dropEmptyShards = envFlag("DROP_EMPTY_SHARDS", true);
  const deleteOrphanGists = envFlag("DELETE_ORPHAN_GISTS", false);

  const repo = new GistRepository();
  const octokit = new Octokit({ auth: token });

  const auth = await repo.verifyToken(token);
  if (!auth) {
    console.error("Token 验证失败");
    process.exit(1);
  }

  let rootGistId = process.env.ROOT_GIST_ID || process.env.GIST_ID || null;
  if (!rootGistId) {
    rootGistId = await repo.findNexusGist();
  }

  if (!rootGistId) {
    console.error("无法找到 Nexus Root Gist，请设置 ROOT_GIST_ID");
    process.exit(1);
  }

  const rootFiles = await repo.getGistFilesByNames(rootGistId, [
    NEXUS_INDEX_V2_FILENAME,
    NEXUS_SHARDS_FILENAME,
  ]);

  const indexFile = rootFiles[NEXUS_INDEX_V2_FILENAME];
  if (!indexFile?.content) {
    console.error(`Root gist (${rootGistId}) 缺少 ${NEXUS_INDEX_V2_FILENAME}`);
    process.exit(1);
  }

  const index = JSON.parse(indexFile.content) as NexusIndex;
  if ((index.version || 1) < 2) {
    console.error("当前 root gist 不是 v2 结构，无法执行 shard 修复");
    process.exit(1);
  }

  const shardsFromRootFile = parseShards(rootFiles[NEXUS_SHARDS_FILENAME]?.content);
  const rawShards = shardsFromRootFile.length > 0
    ? shardsFromRootFile
    : (index.shards || []);

  const categoryNameById = new Map<string, string>();
  const fileById = new Map<string, { categoryId: string; item: GistIndexItem }>();
  for (const category of index.categories) {
    categoryNameById.set(category.id, category.name);
    for (const item of category.items) {
      fileById.set(item.id, { categoryId: category.id, item });
    }
  }

  const dedupedByGist = new Map<string, ShardDescriptor>();
  const duplicateShardRows: ShardDescriptor[] = [];
  for (const row of rawShards) {
    const normalized: ShardDescriptor = {
      id: row.id || `shard-${row.gistId}`,
      gistId: row.gistId,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      part: row.part || inferPart(row.id),
      kind: row.kind || (row.categoryId ? "category" : "large"),
      fileCount: row.fileCount || 0,
      totalBytes: row.totalBytes || 0,
      updated_at: row.updated_at || new Date().toISOString(),
    };

    if (dedupedByGist.has(normalized.gistId)) {
      duplicateShardRows.push(normalized);
      const merged = mergeShardDescriptor(dedupedByGist.get(normalized.gistId)!, normalized);
      dedupedByGist.set(normalized.gistId, merged);
      continue;
    }
    dedupedByGist.set(normalized.gistId, normalized);
  }

  const dedupedShards = Array.from(dedupedByGist.values());
  const repairedShards: ShardDescriptor[] = [];
  const removableShardGists: string[] = [];
  let touchedManifests = 0;

  for (const shard of dedupedShards) {
    const manifest = await repo.fetchShardManifest(shard.gistId);
    touchedManifests += manifest ? 1 : 0;

    const linkedFileIds = new Set<string>();
    for (const [fileId, ref] of fileById.entries()) {
      const storage = ref.item.storage;
      if (!storage) continue;
      if (storage.gistId === shard.gistId || storage.shardId === shard.id) {
        linkedFileIds.add(fileId);
      }
    }

    const manifestFiles = manifest?.files || [];
    const manifestFileById = new Map(manifestFiles.map(f => [f.fileId, f]));

    let categoryId = shard.categoryId;
    if (!categoryId && shard.kind === "category") {
      const categories = new Set<string>();
      for (const linkedId of linkedFileIds) {
        const ref = fileById.get(linkedId);
        if (ref) categories.add(ref.categoryId);
      }
      if (categories.size === 1) {
        categoryId = Array.from(categories)[0];
      }
    }

    const categoryName = shard.kind === "large"
      ? "Large Files"
      : (categoryId ? (categoryNameById.get(categoryId) || categoryId) : (shard.categoryName || "Unknown Category"));

    const filesForStats = linkedFileIds.size > 0
      ? Array.from(linkedFileIds)
          .map(fileId => manifestFileById.get(fileId))
          .filter((x): x is NonNullable<typeof x> => !!x)
      : manifestFiles;

    const linkedCount = linkedFileIds.size;
    const manifestCount = manifestFiles.length;
    const totalBytes = filesForStats.reduce((sum, f) => sum + (f.size || 0), 0);

    const orphanManifestEntries = manifestFiles.filter(f => !fileById.has(f.fileId)).length;

    const repaired: ShardDescriptor = {
      ...shard,
      categoryId: shard.kind === "large" ? undefined : categoryId,
      categoryName,
      part: shard.part || inferPart(shard.id),
      fileCount: linkedCount > 0 ? linkedCount : manifestCount,
      totalBytes,
      updated_at: manifest?.updated_at || shard.updated_at || new Date().toISOString(),
    };

    const emptyAndUnused =
      linkedCount === 0 &&
      manifestCount === 0;

    if (dropEmptyShards && emptyAndUnused) {
      removableShardGists.push(shard.gistId);
      continue;
    }

    repairedShards.push(repaired);

    if (rewriteReadme && apply) {
      const content = buildShardReadme({
        shard: repaired,
        linkedCount,
        manifestCount,
        totalBytes,
        orphanManifestEntries,
      });
      await repo.updateGistFile(shard.gistId, "README.md", content);
    }

    if (rewriteDescription && apply) {
      await octokit.rest.gists.update({
        gist_id: shard.gistId,
        description: buildShardDescription(repaired),
      });
    }
  }

  repairedShards.sort((a, b) => {
    const ka = `${a.kind}:${a.categoryName || ""}:${a.part}`;
    const kb = `${b.kind}:${b.categoryName || ""}:${b.part}`;
    return ka.localeCompare(kb);
  });

  index.shards = repairedShards;
  index.updated_at = new Date().toISOString();

  console.log("========== Shard Repair Summary ==========");
  console.log(`Root Gist: ${rootGistId}`);
  console.log(`Apply Mode: ${apply ? "YES" : "NO (dry-run)"}`);
  console.log(`Raw shard descriptors: ${rawShards.length}`);
  console.log(`Duplicate shard rows merged: ${duplicateShardRows.length}`);
  console.log(`Shard manifests loaded: ${touchedManifests}`);
  console.log(`Repaired shard descriptors: ${repairedShards.length}`);
  console.log(`Empty shard descriptors removed: ${removableShardGists.length}`);
  console.log(`Rewrite README: ${rewriteReadme ? "YES" : "NO"}`);
  console.log(`Rewrite Description: ${rewriteDescription ? "YES" : "NO"}`);
  console.log("=========================================");

  if (!apply) {
    console.log("dry-run 模式未写入任何远程数据。");
    console.log("如需执行修复，请设置 APPLY=1 后重跑。");
    return;
  }

  await repo.updateBatch(rootGistId, {
    [NEXUS_INDEX_V2_FILENAME]: JSON.stringify(index, null, 2),
    [NEXUS_SHARDS_FILENAME]: JSON.stringify(repairedShards, null, 2),
  });

  if (deleteOrphanGists && removableShardGists.length > 0) {
    for (const gistId of removableShardGists) {
      await octokit.rest.gists.delete({ gist_id: gistId });
      console.log(`Deleted orphan shard gist: ${gistId}`);
    }
  } else if (removableShardGists.length > 0) {
    console.log("以下空 shard gist 仅从 index 中移除，未删除远程 gist:");
    for (const gistId of removableShardGists) {
      console.log(`- ${gistId}`);
    }
    console.log("如需删除这些 orphan gist，请设置 DELETE_ORPHAN_GISTS=1 后再运行。");
  }

  console.log("修复完成。");
}

main().catch((e) => {
  console.error("repair_shards 执行失败:", e);
  process.exit(1);
});
