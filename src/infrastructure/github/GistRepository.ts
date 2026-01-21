import { Octokit } from 'octokit'
import type { IGistRepository, GistFile, NexusIndex } from '../../core/domain/types'

const NEXUS_GIST_DESCRIPTION = 'Nexus Configuration Index - Do not edit manually if possible'
const NEXUS_INDEX_FILENAME = 'nexus_index.json'

export class GistRepository implements IGistRepository {
  private octokit: Octokit | null = null

  async verifyToken(token: string): Promise<boolean> {
    try {
      const octokit = new Octokit({ auth: token })
      const { data } = await octokit.rest.users.getAuthenticated()
      this.octokit = octokit
      return !!data.login
    } catch (e) {
      console.error('Token verification failed', e)
      return false
    }
  }

  private ensureAuth() {
    if (!this.octokit) {
      throw new Error('GistRepository not authenticated. Call verifyToken first.')
    }
  }

  async fetchGist(gistId: string): Promise<any> {
    this.ensureAuth()
    const { data } = await this.octokit!.rest.gists.get({ gist_id: gistId })
    return data
  }

  async findNexusGist(): Promise<string | null> {
    this.ensureAuth()
    try {
      // List all gists for the user
      // Note: This returns up to 30 by default, might need pagination for heavy users...
      // But assuming nexus gist is recent or we iterate a bit.
      const { data } = await this.octokit!.rest.gists.list()
      
      const gist = data.find(g => 
        g.description === NEXUS_GIST_DESCRIPTION || 
        (g.files && g.files[NEXUS_INDEX_FILENAME])
      )

      return gist ? gist.id : null
    } catch (e) {
      console.error('Failed to find Nexus Gist', e)
      return null
    }
  }

  async createNexusGist(initialIndex: NexusIndex): Promise<string> {
    this.ensureAuth()
    const { data } = await this.octokit!.rest.gists.create({
      description: NEXUS_GIST_DESCRIPTION,
      public: false,
      files: {
        [NEXUS_INDEX_FILENAME]: {
          content: JSON.stringify(initialIndex, null, 2)
        },
        'README.md': {
          content: '# Nexus Configuration\nManaged by Nexus Extension.'
        }
      }
    })
    return data.id!
  }

  async updateGistFile(gistId: string, filename: string, content: string | null): Promise<void> {
    this.ensureAuth()
    // If content is null, setting it to null interface in octokit deletes it? 
    // Actually Octokit expects explicit null or undefined to ignore, empty string?
    // According to Gist API, key with null value deletes the file.
    // However octokit types might be strict. We'll cast to any if needed or use proper type.
    
    // Using string | null.
    // Note: Gist API requires an object mapping filenames to { content: ... }
    
    const files: Record<string, { content?: string } | null> = {
        [filename]: content === null ? null : { content }
    }

    await this.octokit!.rest.gists.update({
      gist_id: gistId,
      files: files as any // Cast to any because octokit types for delete (null) can be tricky
    })
  }

  async getGistContent(gistId: string): Promise<Record<string, GistFile>> {
    this.ensureAuth()
    const { data } = await this.octokit!.rest.gists.get({ gist_id: gistId })
    
    const result: Record<string, GistFile> = {}
    
    if (data.files) {
      for (const [filename, file] of Object.entries(data.files)) {
        if (file && !file.truncated) { // If truncated, we might need to fetch raw url. Gists < 1MB usually fine.
            // Octokit usually fetches content if small enough.
            // If content is missing but raw_url exists, we might need a separate fetch.
            // For MVP, assuming content is present.
            result[filename] = {
                id: filename,
                filename: filename,
                content: file.content || '',
                language: file.language || undefined,
                updated_at: data.updated_at,
            }
        }
      }
    }
    
    return result
  }
}
