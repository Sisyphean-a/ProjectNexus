import type { ILocalStore } from '../../core/application/ports/ILocalStore'
import type { NexusConfig, NexusIndex } from '../../core/domain/entities/types'

const CONFIG_KEY = 'nexus_config'
const INDEX_KEY = 'nexus_index'
const CACHE_PREFIX = 'nexus_cache_'

declare const chrome: any;

const defaultConfig: NexusConfig = {
  githubToken: '',
  gistId: null,
  rootGistId: null,
  legacyGistId: null,
  schemaVersion: 1,
  tokenVerifiedAt: null,
  syncInterval: 30,
  theme: 'auto',
}

export class LocalStoreRepository implements ILocalStore {
  private isExtension: boolean
  private configCache: NexusConfig | null = null
  private configPromise: Promise<NexusConfig> | null = null
  private indexCache: NexusIndex | null = null
  private indexPromise: Promise<NexusIndex | null> | null = null

  constructor() {
    this.isExtension = typeof chrome !== 'undefined' && !!chrome.storage
  }

  private async get(key: string): Promise<any> {
    if (this.isExtension) {
      const result = await chrome.storage.local.get(key)
      return result[key]
    } else {
      const result = localStorage.getItem(key)
      return result ? JSON.parse(result) : undefined
    }
  }

  private async set(key: string, value: any): Promise<void> {
    if (this.isExtension) {
      await chrome.storage.local.set({ [key]: value })
    } else {
      localStorage.setItem(key, JSON.stringify(value))
    }
  }

  async getConfig(): Promise<NexusConfig> {
    if (this.configCache) {
      return { ...this.configCache }
    }

    if (!this.configPromise) {
      this.configPromise = (async () => {
        const config = await this.get(CONFIG_KEY)
        const merged = { ...defaultConfig, ...config }
        if (!merged.rootGistId && merged.gistId) {
          merged.rootGistId = merged.gistId
        }
        this.configCache = merged
        return merged
      })().finally(() => {
        this.configPromise = null
      })
    }

    return { ...(await this.configPromise) }
  }

  async saveConfig(config: Partial<NexusConfig>): Promise<void> {
    const current = await this.getConfig()
    const next = { ...current, ...config }
    this.configCache = next
    await this.set(CONFIG_KEY, next)
  }

  async getIndex(): Promise<NexusIndex | null> {
    if (this.indexCache) {
      return this.indexCache
    }

    if (!this.indexPromise) {
      this.indexPromise = (async () => {
        const index = (await this.get(INDEX_KEY)) || null
        this.indexCache = index
        return index
      })().finally(() => {
        this.indexPromise = null
      })
    }

    return await this.indexPromise
  }

  async saveIndex(index: NexusIndex): Promise<void> {
    this.indexCache = index
    await this.set(INDEX_KEY, index)
  }

  async getCache(filename: string): Promise<string | null> {
    return (await this.get(CACHE_PREFIX + filename)) || null
  }

  async saveCache(filename: string, content: string): Promise<void> {
    await this.set(CACHE_PREFIX + filename, content)
  }
}
