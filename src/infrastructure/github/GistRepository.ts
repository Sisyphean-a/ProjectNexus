import { Octokit } from "octokit";
import type { IGistRepository } from "../../core/application/ports/IGistRepository";
import type {
  GistFile,
  GistHistoryEntry,
  NexusIndex,
} from "../../core/domain/entities/types";

const NEXUS_GIST_DESCRIPTION =
  "Nexus Configuration Index - Do not edit manually if possible";
const NEXUS_INDEX_FILENAME = "nexus_index.json";

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

  // ... (fetchGist, findNexusGist, createNexusGist remain unchanged)

  async fetchGist(gistId: string): Promise<any> {
    this.ensureAuth();
    const { data } = await this.octokit!.rest.gists.get({ gist_id: gistId });
    return data;
  }

  async findNexusGist(): Promise<string | null> {
    this.ensureAuth();
    try {
      const { data } = await this.octokit!.rest.gists.list();
      const gist = data.find(
        (g: any) =>
          g.description === NEXUS_GIST_DESCRIPTION ||
          (g.files && g.files[NEXUS_INDEX_FILENAME]),
      );
      return gist ? gist.id : null;
    } catch (e) {
      console.error("Failed to find Nexus Gist", e);
      return null;
    }
  }

  async createNexusGist(initialIndex: NexusIndex): Promise<string> {
    this.ensureAuth();
    const { data } = await this.octokit!.rest.gists.create({
      description: NEXUS_GIST_DESCRIPTION,
      public: false,
      files: {
        [NEXUS_INDEX_FILENAME]: {
          content: JSON.stringify(initialIndex, null, 2),
        },
        "README.md": {
          content: "# Nexus Configuration\nManaged by Nexus Extension.",
        },
      },
    });
    return data.id!;
  }

  async updateBatch(
    gistId: string,
    files: Record<string, string | null>,
  ): Promise<string> {
    this.ensureAuth();

    // Prepare payload
    const fileUpdates: Record<string, { content?: string } | null> = {};
    for (const [filename, content] of Object.entries(files)) {
      fileUpdates[filename] = content === null ? null : { content };
    }

    const payload = {
      description: NEXUS_GIST_DESCRIPTION, // Optional but good practice to keep desc updated
      files: fileUpdates,
    };

    console.log(
      "[GistRepository] updateBatch (fetch) payload:",
      JSON.stringify(payload, null, 2),
    );

    try {
      const response = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: "PATCH",
        headers: {
          Authorization: `token ${this._token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "[GistRepository] Fetch Error:",
          response.status,
          errorText,
        );
        throw new Error(
          `Gist Update Failed: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      console.log(
        "[GistRepository] Update successful, new updated_at:",
        data.updated_at,
      );
      return data.updated_at;
    } catch (e: any) {
      console.error("Gist Update Failed:", e.message);
      throw e;
    }
  }

  async updateGistFile(
    gistId: string,
    filename: string,
    content: string | null,
  ): Promise<string> {
    return this.updateBatch(gistId, { [filename]: content });
  }

  /**
   * 重命名 Gist 文件
   * GitHub Gist 不支持直接重命名，需要在一次 PATCH 中同时删除旧文件和创建新文件
   */
  async renameFile(
    gistId: string,
    oldFilename: string,
    newFilename: string,
    content: string,
  ): Promise<string> {
    // 一次 PATCH 请求同时删除旧文件 + 创建新文件
    return this.updateBatch(gistId, {
      [oldFilename]: null, // 删除旧文件
      [newFilename]: content, // 创建新文件
    });
  }

  async getGistContent(gistId: string): Promise<Record<string, GistFile>> {
    this.ensureAuth();

    // 使用 GraphQL 获取 Gist 内容，不包含历史记录
    // 注意：GraphQL ID 和 REST ID 不同，但可以通过 viewer.gist(name: "REST_ID") 或 resource(url: "...") 获取
    // 这里我们尝试通过 viewer.gist 查询，如果不仅是自己的 Gist，可能需要 adjustments。
    // 更稳妥的方式是使用 REST API v3 的 id (即 name)

    // Fallback to REST if complex, but here we want to avoid history.
    // The query below fetches the gist by name (which corresponds to the ID in REST)

    const query = `
      query($name: String!) {
        viewer {
          gist(name: $name) {
            updatedAt
            files(limit: 300) {
              name
              text
            }
          }
        }
      }
    `;

    try {
      // Octokit v5+ supports .graphql
      const response: any = await this.octokit!.graphql(query, {
        name: gistId,
      });

      const gist = response.viewer.gist;
      if (!gist) {
        throw new Error("Gist not found via GraphQL");
      }

      const result: Record<string, GistFile> = {};

      if (gist.files) {
        for (const file of gist.files) {
          if (file) {
            result[file.name] = {
              id: file.name,
              filename: file.name,
              content: file.text || "",
              // GraphQL doesn't strictly return language in simple File object mostly,
              // but we can live without it or add fields if schema supports.
              // File type in GraphQL: name, text, language { name }, encodedName, etc.
              // Let's keep it simple.
              updated_at: gist.updatedAt,
            };
          }
        }
      }
      return result;
    } catch (e) {
      console.warn(
        "GraphQL fetch failed, falling back to REST (with history overhead)",
        e,
      );
      // Fallback to original REST implementation if GraphQL fails (e.g. scopes issues)
      const { data } = await this.octokit!.rest.gists.get({ gist_id: gistId });
      const result: Record<string, GistFile> = {};
      if (data.files) {
        for (const [filename, fileObj] of Object.entries(data.files)) {
          const file = fileObj as GithubGistFile;
          if (file && !file.truncated) {
            result[filename] = {
              id: filename,
              filename: filename,
              content: file.content || "",
              language: file.language || undefined,
              updated_at: data.updated_at,
            };
          }
        }
      }
      return result;
    }
  }

  // 获取版本历史 (使用 REST API 分页获取 commit 列表，而非 get Gist 详情)
  async getGistHistory(gistId: string): Promise<GistHistoryEntry[]> {
    this.ensureAuth();
    // 使用 listCommits 获取历史，避免获取完整内容
    const { data } = await this.octokit!.rest.gists.listCommits({
      gist_id: gistId,
      per_page: 30,
    });

    return data.map((h: any) => ({
      version: h.version,
      committedAt: h.committed_at,
      changeStatus: {
        additions: h.change_status?.additions || 0,
        deletions: h.change_status?.deletions || 0,
        total: h.change_status?.total || 0,
      },
    }));
  }

  // 获取特定版本的内容
  async getGistVersion(
    gistId: string,
    sha: string,
  ): Promise<Record<string, GistFile>> {
    this.ensureAuth();
    const { data } = await this.octokit!.rest.gists.getRevision({
      gist_id: gistId,
      sha: sha,
    });

    const result: Record<string, GistFile> = {};

    if (data.files) {
      for (const [filename, fileObj] of Object.entries(data.files)) {
        const file = fileObj as GithubGistFile;
        if (file && !file.truncated) {
          result[filename] = {
            id: filename,
            filename: filename,
            content: file.content || "",
            language: file.language || undefined,
            updated_at: data.updated_at,
          };
        }
      }
    }

    return result;
  }
}
