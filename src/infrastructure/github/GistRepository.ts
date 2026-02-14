import { Octokit } from "octokit";
import type { IGistRepository } from "../../core/application/ports/IGistRepository";
import type {
  GistFile,
  GistHistoryEntry,
  NexusIndex,
  ShardDescriptor,
  ShardManifest,
} from "../../core/domain/entities/types";

const NEXUS_GIST_DESCRIPTION =
  "Nexus Configuration Index - Do not edit manually if possible";
const NEXUS_INDEX_FILENAME = "nexus_index.json";
const NEXUS_INDEX_V2_FILENAME = "nexus_index_v2.json";
const NEXUS_SHARDS_FILENAME = "nexus_shards.json";
const SHARD_MANIFEST_FILENAME = "shard_manifest.json";

interface GithubGistFile {
  filename?: string;
  type?: string;
  language?: string;
  raw_url?: string;
  size?: number;
  truncated?: boolean;
  content?: string;
}

export class GistRepository implements IGistRepository {
  private octokit: Octokit | null = null;
  private _token: string | null = null;
  public rateLimit = {
    limit: 5000,
    remaining: 5000,
    resetAt: 0,
  };

  setAuthToken(token: string | null): void {
    if (!token) {
      this.octokit = null;
      this._token = null;
      return;
    }

    this.octokit = new Octokit({ auth: token });
    this._token = token;
  }

  async verifyToken(token: string): Promise<boolean> {
    try {
      const octokit = new Octokit({ auth: token });
      const { data } = await octokit.rest.users.getAuthenticated();
      this.octokit = octokit;
      this._token = token;
      return !!data.login;
    } catch (e) {
      console.error("Token verification failed", e);
      return false;
    }
  }

  private ensureAuth() {
    if (!this.octokit || !this._token) {
      throw new Error(
        "GistRepository not authenticated. Call verifyToken first.",
      );
    }
  }

  private updateRateLimit(headers: Headers | any) {
    const limit = headers.get
      ? headers.get("x-ratelimit-limit")
      : headers["x-ratelimit-limit"];
    const remaining = headers.get
      ? headers.get("x-ratelimit-remaining")
      : headers["x-ratelimit-remaining"];
    const reset = headers.get
      ? headers.get("x-ratelimit-reset")
      : headers["x-ratelimit-reset"];

    if (limit) this.rateLimit.limit = parseInt(limit);
    if (remaining) this.rateLimit.remaining = parseInt(remaining);
    if (reset) this.rateLimit.resetAt = parseInt(reset) * 1000;
  }

  private async requestWithRetry<T>(
    fn: () => Promise<T>,
    retries = 3,
    delay = 1000,
  ): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      const isRateLimit = e.status === 403 || e.status === 429;
      if (isRateLimit && retries > 0) {
        console.warn(
          `[GistRepository] Rate limited, retry in ${delay}ms...`,
          e.message,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.requestWithRetry(fn, retries - 1, delay * 2);
      }
      throw e;
    }
  }

  private async fetchRawContent(rawUrl: string): Promise<string> {
    const response = await fetch(rawUrl, {
      headers: {
        Authorization: `token ${this._token}`,
        Accept: "application/vnd.github.v3.raw",
      },
    });

    this.updateRateLimit(response.headers);

    if (!response.ok) {
      const error: any = new Error(`Raw file fetch failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return response.text();
  }

  private async normalizeFile(
    filename: string,
    file: GithubGistFile,
    gistUpdatedAt?: string,
  ): Promise<GistFile> {
    let content = file.content || "";

    if (file.truncated && file.raw_url) {
      content = await this.fetchRawContent(file.raw_url);
    }

    return {
      id: filename,
      filename,
      content,
      language: file.language || undefined,
      updated_at: gistUpdatedAt,
    };
  }

  async fetchGist(gistId: string): Promise<any> {
    this.ensureAuth();
    return this.requestWithRetry(async () => {
      const { data, headers } = await this.octokit!.rest.gists.get({
        gist_id: gistId,
      });
      this.updateRateLimit(headers);
      return data;
    });
  }

  async findNexusGist(): Promise<string | null> {
    this.ensureAuth();
    return this.requestWithRetry(async () => {
      const { data, headers } = await this.octokit!.rest.gists.list();
      this.updateRateLimit(headers);
      const gist = data.find(
        (g: any) =>
          g.description === NEXUS_GIST_DESCRIPTION ||
          (g.files &&
            (g.files[NEXUS_INDEX_FILENAME] || g.files[NEXUS_INDEX_V2_FILENAME])),
      );
      return gist ? gist.id : null;
    });
  }

  async createNexusGist(initialIndex: NexusIndex): Promise<string> {
    this.ensureAuth();

    const isV2 = (initialIndex.version || 1) >= 2;
    const files: Record<string, { content: string }> = {
      "README.md": {
        content: "# Nexus Configuration\nManaged by Nexus Extension.",
      },
    };

    if (isV2) {
      files[NEXUS_INDEX_V2_FILENAME] = {
        content: JSON.stringify(initialIndex, null, 2),
      };
      files[NEXUS_SHARDS_FILENAME] = {
        content: JSON.stringify(initialIndex.shards || [], null, 2),
      };
    } else {
      files[NEXUS_INDEX_FILENAME] = {
        content: JSON.stringify(initialIndex, null, 2),
      };
    }

    const { data, headers } = await this.requestWithRetry(async () =>
      this.octokit!.rest.gists.create({
        description: NEXUS_GIST_DESCRIPTION,
        public: false,
        files,
      }),
    );
    this.updateRateLimit(headers);
    return data.id!;
  }

  async createShardGist(
    shardId: string,
    categoryName: string,
    part: number,
    categoryId?: string,
    kind: "category" | "large" = "category",
  ): Promise<string> {
    this.ensureAuth();

    const initialManifest: ShardManifest = {
      version: 1,
      shardId,
      updated_at: new Date().toISOString(),
      files: [],
    };

    const { data, headers } = await this.requestWithRetry(async () =>
      this.octokit!.rest.gists.create({
        description: `Nexus Shard [${kind}] ${categoryName} (${categoryId || "N/A"}) #${part}`,
        public: false,
        files: {
          [SHARD_MANIFEST_FILENAME]: {
            content: JSON.stringify(initialManifest, null, 2),
          },
          "README.md": {
            content: `# Nexus Shard

[${kind}] ${categoryName} · Part ${part}

| Key | Value |
| --- | --- |
| Shard | ${shardId} |
| Category | ${categoryName} (${categoryId || "N/A"}) |
| Status | Initial |
`,
          },
        },
      }),
    );

    this.updateRateLimit(headers);
    return data.id!;
  }

  async updateBatch(
    gistId: string,
    files: Record<string, string | null>,
  ): Promise<string> {
    this.ensureAuth();

    const fileUpdates: Record<string, { content?: string } | null> = {};
    for (const [filename, content] of Object.entries(files)) {
      fileUpdates[filename] = content === null ? null : { content };
    }

    const payload = {
      files: fileUpdates,
    };

    const response = await this.requestWithRetry(async () => {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: "PATCH",
        headers: {
          Authorization: `token ${this._token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      this.updateRateLimit(res.headers);
      if (!res.ok) {
        const error: any = new Error(`Gist Update Failed: ${res.status}`);
        error.status = res.status;
        throw error;
      }
      return res;
    });

    const data = await response.json();
    return data.updated_at;
  }

  async updateGistFile(
    gistId: string,
    filename: string,
    content: string | null,
  ): Promise<string> {
    return this.updateBatch(gistId, { [filename]: content });
  }

  async getGistContent(gistId: string): Promise<Record<string, GistFile>> {
    this.ensureAuth();

    const { data, headers } = await this.requestWithRetry(async () =>
      this.octokit!.rest.gists.get({ gist_id: gistId }),
    );
    this.updateRateLimit(headers);

    const result: Record<string, GistFile> = {};

    if (data.files) {
      for (const [filename, fileObj] of Object.entries(data.files)) {
        const file = fileObj as GithubGistFile;
        result[filename] = await this.normalizeFile(filename, file, data.updated_at);
      }
    }

    return result;
  }

  async getGistFilesByNames(
    gistId: string,
    filenames: string[],
  ): Promise<Record<string, GistFile>> {
    if (filenames.length === 0) {
      return {};
    }

    this.ensureAuth();

    const wanted = new Set(filenames);
    const { data, headers } = await this.requestWithRetry(async () =>
      this.octokit!.rest.gists.get({ gist_id: gistId }),
    );
    this.updateRateLimit(headers);

    const result: Record<string, GistFile> = {};
    if (!data.files) {
      return result;
    }

    for (const [filename, fileObj] of Object.entries(data.files)) {
      if (!wanted.has(filename)) continue;
      const file = fileObj as GithubGistFile;
      result[filename] = await this.normalizeFile(filename, file, data.updated_at);
    }

    return result;
  }

  async getGistHistory(gistId: string): Promise<GistHistoryEntry[]> {
    this.ensureAuth();
    return this.requestWithRetry(async () => {
      const { data, headers } = await this.octokit!.rest.gists.listCommits({
        gist_id: gistId,
        per_page: 30,
      });
      this.updateRateLimit(headers);

      return data.map((h: any) => ({
        version: h.version,
        committedAt: h.committed_at,
        changeStatus: {
          additions: h.change_status?.additions || 0,
          deletions: h.change_status?.deletions || 0,
          total: h.change_status?.total || 0,
        },
      }));
    });
  }

  async getGistVersion(
    gistId: string,
    sha: string,
  ): Promise<Record<string, GistFile>> {
    this.ensureAuth();
    return this.requestWithRetry(async () => {
      const { data, headers } = await this.octokit!.rest.gists.getRevision({
        gist_id: gistId,
        sha,
      });
      this.updateRateLimit(headers);

      const result: Record<string, GistFile> = {};

      if (data.files) {
        for (const [filename, fileObj] of Object.entries(data.files)) {
          const file = fileObj as GithubGistFile;
          result[filename] = await this.normalizeFile(filename, file, data.updated_at);
        }
      }

      return result;
    });
  }

  async updateGistDescription(gistId: string, description: string): Promise<void> {
    this.ensureAuth();
    const { headers } = await this.requestWithRetry(async () =>
      this.octokit!.rest.gists.update({
        gist_id: gistId,
        description,
      }),
    );
    this.updateRateLimit(headers);
  }

  async deleteGist(gistId: string): Promise<void> {
    this.ensureAuth();
    const { headers } = await this.requestWithRetry(async () =>
      this.octokit!.rest.gists.delete({ gist_id: gistId }),
    );
    this.updateRateLimit(headers);
  }

  async listNexusShards(rootGistId: string): Promise<ShardDescriptor[]> {
    const files = await this.getGistFilesByNames(rootGistId, [NEXUS_SHARDS_FILENAME]);
    const shardFile = files[NEXUS_SHARDS_FILENAME];
    if (!shardFile?.content) {
      return [];
    }

    try {
      const parsed = JSON.parse(shardFile.content) as ShardDescriptor[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn("Failed to parse nexus_shards.json", e);
      return [];
    }
  }

  async listAllShardGistIds(): Promise<string[]> {
    this.ensureAuth();

    const result: string[] = [];
    let page = 1;

    while (true) {
      const { data, headers } = await this.requestWithRetry(async () =>
        this.octokit!.rest.gists.list({
          per_page: 100,
          page,
        }),
      );
      this.updateRateLimit(headers);

      if (!data || data.length === 0) {
        break;
      }

      for (const gist of data as any[]) {
        const hasShardDesc = (gist.description || "").includes("Nexus Shard");
        const hasShardManifest = !!gist.files?.["shard_manifest.json"];
        if (hasShardDesc || hasShardManifest) {
          if (gist.id) {
            result.push(gist.id);
          }
        }
      }

      if (data.length < 100) {
        break;
      }
      page += 1;
    }

    return Array.from(new Set(result));
  }

  async fetchShardManifest(gistId: string): Promise<ShardManifest | null> {
    const files = await this.getGistFilesByNames(gistId, [SHARD_MANIFEST_FILENAME]);
    const manifestFile = files[SHARD_MANIFEST_FILENAME];
    if (!manifestFile?.content) {
      return null;
    }

    try {
      const parsed = JSON.parse(manifestFile.content) as ShardManifest;
      if (!parsed || !Array.isArray(parsed.files)) {
        return null;
      }
      return parsed;
    } catch (e) {
      console.warn(`Failed to parse ${SHARD_MANIFEST_FILENAME}`, e);
      return null;
    }
  }

  async updateShardManifest(
    gistId: string,
    manifest: ShardManifest,
  ): Promise<string> {
    manifest.updated_at = new Date().toISOString();
    return this.updateGistFile(
      gistId,
      SHARD_MANIFEST_FILENAME,
      JSON.stringify(manifest, null, 2),
    );
  }
}
