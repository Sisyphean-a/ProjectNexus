import { Octokit } from "octokit";
import type {
  IGistRepository,
  GistFile,
  GistHistoryEntry,
  NexusIndex,
} from "../../core/domain/types";

const NEXUS_GIST_DESCRIPTION =
  "Nexus Configuration Index - Do not edit manually if possible";
const NEXUS_INDEX_FILENAME = "nexus_index.json";

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
        (g) =>
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
  ): Promise<void> {
    this.ensureAuth();
    
    // Prepare payload
    const fileUpdates: Record<string, { content?: string } | null> = {};
    for (const [filename, content] of Object.entries(files)) {
      fileUpdates[filename] = content === null ? null : { content };
    }
    
    const payload = {
        description: NEXUS_GIST_DESCRIPTION, // Optional but good practice to keep desc updated
        files: fileUpdates
    };

    console.log('[GistRepository] updateBatch (fetch) payload:', JSON.stringify(payload, null, 2));

    try {
      const response = await fetch(`https://api.github.com/gists/${gistId}`, {
          method: 'PATCH',
          headers: {
              'Authorization': `token ${this._token}`,
              'Accept': 'application/vnd.github.v3+json',
              'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
      });

      if (!response.ok) {
          const errorText = await response.text();
          console.error('[GistRepository] Fetch Error:', response.status, errorText);
          throw new Error(`Gist Update Failed: ${response.status} ${response.statusText}`);
      }
      
      console.log('[GistRepository] Update successful');
    } catch (e: any) {
        console.error('Gist Update Failed:', e.message)
        throw e
    }
  }

  async updateGistFile(
    gistId: string,
    filename: string,
    content: string | null,
  ): Promise<void> {
    return this.updateBatch(gistId, { [filename]: content })
  }

  /**
   * 重命名 Gist 文件
   * GitHub Gist 不支持直接重命名，需要在一次 PATCH 中同时删除旧文件和创建新文件
   */
  async renameFile(
    gistId: string,
    oldFilename: string,
    newFilename: string,
    content: string
  ): Promise<void> {
    // 一次 PATCH 请求同时删除旧文件 + 创建新文件
    return this.updateBatch(gistId, {
      [oldFilename]: null,      // 删除旧文件
      [newFilename]: content    // 创建新文件
    })
  }

  async getGistContent(gistId: string): Promise<Record<string, GistFile>> {
    this.ensureAuth();
    const { data } = await this.octokit!.rest.gists.get({ gist_id: gistId });

    const result: Record<string, GistFile> = {};

    if (data.files) {
      for (const [filename, file] of Object.entries(data.files)) {
        if (file && !file.truncated) {
          // If truncated, we might need to fetch raw url. Gists < 1MB usually fine.
          // Octokit usually fetches content if small enough.
          // If content is missing but raw_url exists, we might need a separate fetch.
          // For MVP, assuming content is present.
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

  // 获取版本历史
  async getGistHistory(gistId: string): Promise<GistHistoryEntry[]> {
    this.ensureAuth();
    const { data } = await this.octokit!.rest.gists.get({ gist_id: gistId });

    if (!data.history) return [];

    return data.history.map((h: any) => ({
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
      for (const [filename, file] of Object.entries(data.files)) {
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
