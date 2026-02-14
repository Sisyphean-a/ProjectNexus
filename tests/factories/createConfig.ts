import type { NexusConfig } from "../../src/core/domain/entities/types";

export function createConfig(
  overrides: Partial<NexusConfig> = {},
): NexusConfig {
  return {
    githubToken: "token",
    gistId: "root-gist",
    rootGistId: "root-gist",
    legacyGistId: null,
    schemaVersion: 2,
    syncInterval: 30,
    theme: "auto",
    ...overrides,
  };
}
