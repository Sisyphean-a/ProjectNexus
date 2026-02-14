import type {
  GistIndexCategory,
  GistIndexItem,
  NexusIndex,
  ShardDescriptor,
} from "../../src/core/domain/entities/types";

export function createShard(
  overrides: Partial<ShardDescriptor> = {},
): ShardDescriptor {
  return {
    id: "shard-1",
    gistId: "shard-gist-1",
    categoryId: "cat-a",
    categoryName: "Category A",
    part: 1,
    kind: "category",
    fileCount: 1,
    totalBytes: 12,
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function createIndexItem(
  overrides: Partial<GistIndexItem> = {},
): GistIndexItem {
  return {
    id: "file-1",
    title: "File 1",
    gist_file: "file-1.yaml",
    language: "yaml",
    storage: {
      shardId: "shard-1",
      gistId: "shard-gist-1",
      gist_file: "file-1.yaml",
    },
    ...overrides,
  };
}

export function createCategory(
  overrides: Partial<GistIndexCategory> = {},
): GistIndexCategory {
  const defaultItem = createIndexItem();
  return {
    id: "cat-a",
    name: "Category A",
    defaultLanguage: "yaml",
    items: [defaultItem],
    ...overrides,
  };
}

export function createIndex(
  overrides: Partial<NexusIndex> = {},
): NexusIndex {
  const base: NexusIndex = {
    version: 2,
    updated_at: "2026-01-01T00:00:00.000Z",
    categories: [createCategory()],
    shards: [createShard()],
  };

  return {
    ...base,
    ...overrides,
    categories: overrides.categories
      ? structuredClone(overrides.categories)
      : structuredClone(base.categories),
    shards: overrides.shards
      ? structuredClone(overrides.shards)
      : structuredClone(base.shards),
  };
}
