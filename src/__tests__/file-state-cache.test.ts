import { describe, expect, test, beforeEach } from 'bun:test'
import { FileStateCache, type FileState } from '../utils/fileStateCache.js'

describe('FileStateCache', () => {
  let cache: FileStateCache

  beforeEach(() => {
    cache = new FileStateCache()
  })

  // ---------------------------------------------------------------------------
  // Basic CRUD
  // ---------------------------------------------------------------------------

  test('set and get a file state', () => {
    const state: FileState = {
      content: 'hello world',
      timestamp: Date.now(),
      offset: undefined,
      limit: undefined,
    }
    cache.set('/foo/bar.ts', state)

    const retrieved = cache.get('/foo/bar.ts')
    expect(retrieved).toEqual(state)
  })

  test('get returns undefined for missing entry', () => {
    expect(cache.get('/nonexistent')).toBeUndefined()
  })

  test('has returns true for existing entry', () => {
    cache.set('/foo.ts', {
      content: 'x',
      timestamp: 1,
      offset: undefined,
      limit: undefined,
    })
    expect(cache.has('/foo.ts')).toBe(true)
  })

  test('has returns false for missing entry', () => {
    expect(cache.has('/missing.ts')).toBe(false)
  })

  test('clear removes all entries', () => {
    cache.set('/a.ts', { content: 'a', timestamp: 1, offset: undefined, limit: undefined })
    cache.set('/b.ts', { content: 'b', timestamp: 2, offset: undefined, limit: undefined })
    cache.clear()

    expect(cache.has('/a.ts')).toBe(false)
    expect(cache.has('/b.ts')).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Path normalization
  // ---------------------------------------------------------------------------

  test('normalizes paths on set and get', () => {
    cache.set('/foo/bar/../baz.ts', {
      content: 'normalized',
      timestamp: 1,
      offset: undefined,
      limit: undefined,
    })

    expect(cache.get('/foo/baz.ts')).toBeDefined()
    expect(cache.get('/foo/baz.ts')!.content).toBe('normalized')
  })

  test('normalizes paths on has', () => {
    cache.set('/foo/./bar.ts', {
      content: 'x',
      timestamp: 1,
      offset: undefined,
      limit: undefined,
    })
    expect(cache.has('/foo/bar.ts')).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // LRU eviction by entry count
  // ---------------------------------------------------------------------------

  test('evicts oldest entry when max entries exceeded', () => {
    const small = new FileStateCache({ maxEntries: 3, maxTotalSizeBytes: Infinity })

    for (let i = 0; i < 3; i++) {
      small.set(`/file${i}.ts`, {
        content: `content-${i}`,
        timestamp: i,
        offset: undefined,
        limit: undefined,
      })
    }

    // All three should be present
    expect(small.has('/file0.ts')).toBe(true)
    expect(small.has('/file1.ts')).toBe(true)
    expect(small.has('/file2.ts')).toBe(true)

    // Adding a 4th evicts the oldest (file0)
    small.set('/file3.ts', {
      content: 'content-3',
      timestamp: 3,
      offset: undefined,
      limit: undefined,
    })

    expect(small.has('/file0.ts')).toBe(false)
    expect(small.has('/file1.ts')).toBe(true)
    expect(small.has('/file3.ts')).toBe(true)
  })

  test('get refreshes entry making it most-recently-used', () => {
    const small = new FileStateCache({ maxEntries: 3, maxTotalSizeBytes: Infinity })

    small.set('/a.ts', { content: 'a', timestamp: 1, offset: undefined, limit: undefined })
    small.set('/b.ts', { content: 'b', timestamp: 2, offset: undefined, limit: undefined })
    small.set('/c.ts', { content: 'c', timestamp: 3, offset: undefined, limit: undefined })

    // Touch /a.ts so it becomes most-recently-used
    small.get('/a.ts')

    // Adding /d.ts should evict /b.ts (now the oldest)
    small.set('/d.ts', { content: 'd', timestamp: 4, offset: undefined, limit: undefined })

    expect(small.has('/a.ts')).toBe(true)
    expect(small.has('/b.ts')).toBe(false)
    expect(small.has('/c.ts')).toBe(true)
    expect(small.has('/d.ts')).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // LRU eviction by total size
  // ---------------------------------------------------------------------------

  test('evicts oldest entries when max total size exceeded', () => {
    // Each entry ~10 bytes content. Max 25 bytes total.
    const small = new FileStateCache({ maxEntries: 100, maxTotalSizeBytes: 25 })

    small.set('/a.ts', { content: '1234567890', timestamp: 1, offset: undefined, limit: undefined }) // 10 bytes
    small.set('/b.ts', { content: '1234567890', timestamp: 2, offset: undefined, limit: undefined }) // 10 bytes — total 20

    expect(small.has('/a.ts')).toBe(true)
    expect(small.has('/b.ts')).toBe(true)

    // Adding another 10 bytes pushes total to 30 > 25, so /a.ts should be evicted
    small.set('/c.ts', { content: '1234567890', timestamp: 3, offset: undefined, limit: undefined })

    expect(small.has('/a.ts')).toBe(false)
    expect(small.has('/b.ts')).toBe(true)
    expect(small.has('/c.ts')).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Overwrite existing entry
  // ---------------------------------------------------------------------------

  test('overwriting an entry updates content and timestamp', () => {
    cache.set('/foo.ts', { content: 'old', timestamp: 1, offset: undefined, limit: undefined })
    cache.set('/foo.ts', { content: 'new', timestamp: 2, offset: undefined, limit: undefined })

    const state = cache.get('/foo.ts')
    expect(state!.content).toBe('new')
    expect(state!.timestamp).toBe(2)
  })

  // ---------------------------------------------------------------------------
  // Partial view flag
  // ---------------------------------------------------------------------------

  test('stores and retrieves isPartialView flag', () => {
    cache.set('/partial.ts', {
      content: 'partial content',
      timestamp: 1,
      offset: 10,
      limit: 20,
      isPartialView: true,
    })

    const state = cache.get('/partial.ts')
    expect(state!.isPartialView).toBe(true)
    expect(state!.offset).toBe(10)
    expect(state!.limit).toBe(20)
  })

  // ---------------------------------------------------------------------------
  // Default config
  // ---------------------------------------------------------------------------

  test('default cache accepts at least 100 entries', () => {
    for (let i = 0; i < 100; i++) {
      cache.set(`/file${i}.ts`, {
        content: `c${i}`,
        timestamp: i,
        offset: undefined,
        limit: undefined,
      })
    }

    // All 100 should still be present
    expect(cache.has('/file0.ts')).toBe(true)
    expect(cache.has('/file99.ts')).toBe(true)
  })
})
