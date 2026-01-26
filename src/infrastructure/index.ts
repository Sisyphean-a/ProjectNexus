import { GistRepository } from './github/GistRepository'
import { LocalStoreRepository } from './storage/LocalStore'

export const gistRepository = new GistRepository()
export const localStoreRepository = new LocalStoreRepository()
export { nexusDb } from './db/NexusDatabase'
import { LocalFileRepository } from './db/LocalFileRepository'
export const fileRepository = new LocalFileRepository()
export { localHistoryRepository } from './storage/LocalHistoryRepository'
