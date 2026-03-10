import { describe, expect, it, vi } from "vitest";
import { ShardFetchPlanner } from "../ShardFetchPlanner";

function createPlanner(delayMs = 5) {
  let active = 0;
  let maxActive = 0;

  const gistRepo = {
    fetchShardManifest: vi.fn(async (gistId: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      active -= 1;
      return {
        version: 1,
        shardId: gistId,
        updated_at: "2026-01-01T00:00:00.000Z",
        files: [],
      };
    }),
    getGistFilesByNames: vi.fn(),
  };

  return {
    planner: new ShardFetchPlanner(gistRepo as any),
    gistRepo,
    getMaxActive: () => maxActive,
  };
}

describe("ShardFetchPlanner", () => {
  it("fetchManifests 会遵守并发上限", async () => {
    const { planner, getMaxActive } = createPlanner();

    const results = await planner.fetchManifests(
      ["gist-1", "gist-2", "gist-3", "gist-4", "gist-5"],
      2,
    );

    expect(results).toHaveLength(5);
    expect(getMaxActive()).toBeLessThanOrEqual(2);
  });
});
