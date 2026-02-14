import { beforeEach, describe, expect, it, vi } from "vitest";
import { GistRepository } from "../GistRepository";

function createAuthedRepository() {
  const repo = new GistRepository() as any;

  repo._token = "token";
  repo.octokit = {
    rest: {
      gists: {
        get: vi.fn(),
        list: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        listCommits: vi.fn(),
        getRevision: vi.fn(),
      },
    },
  };

  return {
    repo: repo as GistRepository,
    internals: repo,
  };
}

describe("GistRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetchGist 在限流时会重试", async () => {
    vi.useFakeTimers();
    const { repo, internals } = createAuthedRepository();
    const rateError = Object.assign(new Error("rate limited"), { status: 429 });

    internals.octokit.rest.gists.get
      .mockRejectedValueOnce(rateError)
      .mockResolvedValueOnce({
        data: { id: "gist-1", updated_at: "2026-01-01T00:00:00.000Z" },
        headers: {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4999",
          "x-ratelimit-reset": "123",
        },
      });

    const fetchPromise = repo.fetchGist("gist-1");
    await vi.advanceTimersByTimeAsync(1000);
    const result = await fetchPromise;

    expect(result.id).toBe("gist-1");
    expect(internals.octokit.rest.gists.get).toHaveBeenCalledTimes(2);
    expect(repo.rateLimit.remaining).toBe(4999);
  });

  it("getGistFilesByNames 会拉取 truncated 文件的 raw 内容", async () => {
    const { repo, internals } = createAuthedRepository();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("full-raw-content", {
        status: 200,
        headers: {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4990",
          "x-ratelimit-reset": "999",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    internals.octokit.rest.gists.get.mockResolvedValue({
      data: {
        updated_at: "2026-01-01T00:00:00.000Z",
        files: {
          "wanted.txt": {
            language: "Text",
            content: "partial",
            truncated: true,
            raw_url: "https://example.com/raw/wanted.txt",
          },
          "ignored.txt": {
            language: "Text",
            content: "ignore",
          },
        },
      },
      headers: {
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-reset": "1000",
      },
    });

    const files = await repo.getGistFilesByNames("gist-1", ["wanted.txt"]);

    expect(Object.keys(files)).toEqual(["wanted.txt"]);
    expect(files["wanted.txt"].content).toBe("full-raw-content");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/raw/wanted.txt",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "token token",
        }),
      }),
    );
  });

  it("updateBatch 会把 null 转换为删除操作并返回 updated_at", async () => {
    const { repo } = createAuthedRepository();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4988",
        "x-ratelimit-reset": "1001",
      }),
      json: async () => ({ updated_at: "2026-02-01T00:00:00.000Z" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const updatedAt = await repo.updateBatch("gist-1", {
      "keep.txt": "content",
      "delete.txt": null,
    });

    const [, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse((options as RequestInit).body as string);

    expect(payload.files["keep.txt"]).toEqual({ content: "content" });
    expect(payload.files["delete.txt"]).toBeNull();
    expect(updatedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("updateBatch 在非 2xx 响应时抛出错误", async () => {
    const { repo } = createAuthedRepository();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
      }),
    );

    await expect(
      repo.updateBatch("gist-1", { "a.txt": "content" }),
    ).rejects.toThrow("Gist Update Failed: 500");
  });

  it("listNexusShards 在 JSON 非法时返回空数组", async () => {
    const { repo } = createAuthedRepository();
    vi.spyOn(repo, "getGistFilesByNames").mockResolvedValue({
      "nexus_shards.json": {
        id: "nexus_shards.json",
        filename: "nexus_shards.json",
        content: "{broken-json}",
      },
    });

    const shards = await repo.listNexusShards("root-gist");

    expect(shards).toEqual([]);
  });

  it("listAllShardGistIds 会去重并识别分片 gist", async () => {
    const { repo, internals } = createAuthedRepository();

    internals.octokit.rest.gists.list.mockResolvedValue({
      data: [
        { id: "gist-1", description: "Nexus Shard [category] A", files: {} },
        { id: "gist-1", description: "Nexus Shard [category] A", files: {} },
        {
          id: "gist-2",
          description: "misc",
          files: { "shard_manifest.json": { filename: "shard_manifest.json" } },
        },
        { id: "gist-3", description: "misc", files: {} },
      ],
      headers: {
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4998",
        "x-ratelimit-reset": "1002",
      },
    });

    const ids = await repo.listAllShardGistIds();

    expect(ids.sort()).toEqual(["gist-1", "gist-2"]);
    expect(internals.octokit.rest.gists.list).toHaveBeenCalledTimes(1);
  });
});
