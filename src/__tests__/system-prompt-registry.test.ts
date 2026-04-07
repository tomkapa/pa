import { afterEach, describe, expect, test } from 'bun:test'
import {
  cachedSection,
  resetSectionCache,
  resolveSections,
  resolveSectionsDetailed,
  uncachedSection,
} from '../services/system-prompt/registry.js'

afterEach(() => resetSectionCache())

describe('cachedSection', () => {
  test('computes once across multiple resolves', async () => {
    let calls = 0
    const section = cachedSection('foo', () => {
      calls++
      return `value-${calls}`
    })

    const first = await resolveSections([section])
    const second = await resolveSections([section])
    expect(first).toEqual(['value-1'])
    expect(second).toEqual(['value-1'])
    expect(calls).toBe(1)
  })

  test('caches null values too', async () => {
    let calls = 0
    const section = cachedSection('opt-out', () => {
      calls++
      return null
    })
    await resolveSections([section])
    await resolveSections([section])
    expect(calls).toBe(1)
  })

  test('resetSectionCache forces recompute', async () => {
    let calls = 0
    const section = cachedSection('foo', () => {
      calls++
      return `value-${calls}`
    })
    await resolveSections([section])
    resetSectionCache()
    const second = await resolveSections([section])
    expect(second).toEqual(['value-2'])
    expect(calls).toBe(2)
  })

  test('supports async compute functions', async () => {
    const section = cachedSection('async', async () => {
      await Promise.resolve()
      return 'async-value'
    })
    expect(await resolveSections([section])).toEqual(['async-value'])
  })
})

describe('uncachedSection', () => {
  test('recomputes on every resolve', async () => {
    let calls = 0
    const section = uncachedSection(
      'volatile',
      () => {
        calls++
        return `tick-${calls}`
      },
      'used in test — recomputes every turn',
    )
    expect(await resolveSections([section])).toEqual(['tick-1'])
    expect(await resolveSections([section])).toEqual(['tick-2'])
    expect(await resolveSections([section])).toEqual(['tick-3'])
    expect(calls).toBe(3)
  })

  test('does not pollute the cache', async () => {
    const section = uncachedSection(
      'volatile',
      () => 'val',
      'used in test',
    )
    await resolveSections([section])
    // Recompute once more — should still be 2 calls (no cache hit).
    let calls = 0
    const section2 = uncachedSection(
      'volatile',
      () => {
        calls++
        return 'val'
      },
      'used in test',
    )
    await resolveSections([section2])
    expect(calls).toBe(1)
  })

  test('throws when reason is empty', () => {
    expect(() => uncachedSection('foo', () => 'bar', '')).toThrow(/reason/)
    expect(() => uncachedSection('foo', () => 'bar', '   ')).toThrow(/reason/)
  })
})

describe('resolveSections', () => {
  test('preserves section order in the result', async () => {
    const a = cachedSection('a', () => 'A')
    const b = cachedSection('b', () => 'B')
    const c = cachedSection('c', () => 'C')
    const result = await resolveSections([a, b, c])
    expect(result).toEqual(['A', 'B', 'C'])
  })

  test('runs builders in parallel (combined latency ~max not sum)', async () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
    const a = cachedSection('a', async () => {
      await sleep(50)
      return 'A'
    })
    const b = cachedSection('b', async () => {
      await sleep(50)
      return 'B'
    })
    const start = Date.now()
    await resolveSections([a, b])
    const elapsed = Date.now() - start
    // Sequential would be ~100ms; parallel should be ~50ms. Allow generous slack.
    expect(elapsed).toBeLessThan(95)
  })
})

describe('resolveSectionsDetailed', () => {
  test('reports cache hits and misses', async () => {
    const section = cachedSection('foo', () => 'bar')

    const first = await resolveSectionsDetailed([section])
    expect(first[0]?.fromCache).toBe(false)
    expect(first[0]?.value).toBe('bar')

    const second = await resolveSectionsDetailed([section])
    expect(second[0]?.fromCache).toBe(true)
    expect(second[0]?.value).toBe('bar')
  })

  test('uncached sections always report fromCache=false', async () => {
    const section = uncachedSection('foo', () => 'bar', 'test')
    const first = await resolveSectionsDetailed([section])
    const second = await resolveSectionsDetailed([section])
    expect(first[0]?.fromCache).toBe(false)
    expect(second[0]?.fromCache).toBe(false)
  })
})
