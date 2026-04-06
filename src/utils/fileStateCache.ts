import { normalize } from 'node:path'

export interface FileState {
  content: string
  timestamp: number
  offset?: number
  limit?: number
  isPartialView?: boolean
}

interface FileStateCacheOptions {
  maxEntries: number
  maxTotalSizeBytes: number
}

const DEFAULT_OPTIONS: FileStateCacheOptions = {
  maxEntries: 100,
  maxTotalSizeBytes: 25 * 1024 * 1024, // 25 MB
}

export class FileStateCache {
  private readonly map = new Map<string, FileState>()
  private readonly options: FileStateCacheOptions
  private totalSize = 0

  constructor(options?: Partial<FileStateCacheOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  get(filePath: string): FileState | undefined {
    const key = normalize(filePath)
    const entry = this.map.get(key)
    if (entry === undefined) return undefined

    // Move to end (most-recently-used)
    this.map.delete(key)
    this.map.set(key, entry)
    return entry
  }

  set(filePath: string, state: FileState): void {
    const key = normalize(filePath)

    // Remove existing entry's size contribution
    const existing = this.map.get(key)
    if (existing !== undefined) {
      this.totalSize -= Buffer.byteLength(existing.content)
      this.map.delete(key)
    }

    const entrySize = Buffer.byteLength(state.content)

    // Evict by entry count
    while (this.map.size >= this.options.maxEntries) {
      this.evictOldest()
    }

    // Evict by total size
    while (this.totalSize + entrySize > this.options.maxTotalSizeBytes && this.map.size > 0) {
      this.evictOldest()
    }

    this.map.set(key, state)
    this.totalSize += entrySize
  }

  has(filePath: string): boolean {
    return this.map.has(normalize(filePath))
  }

  clear(): void {
    this.map.clear()
    this.totalSize = 0
  }

  private evictOldest(): void {
    const oldest = this.map.keys().next()
    if (oldest.done) return

    const key = oldest.value
    const entry = this.map.get(key)!
    this.totalSize -= Buffer.byteLength(entry.content)
    this.map.delete(key)
  }
}
