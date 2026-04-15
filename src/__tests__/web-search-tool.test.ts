import { describe, expect, test } from 'bun:test'
import {
  webSearchToolDef,
  buildSearchQuery,
  WEB_SEARCH_TOOL_NAME,
  type WebSearchToolInput,
} from '../tools/webSearchTool.js'
import { makeContext } from '../testing/make-context.js'

describe('buildSearchQuery', () => {
  test('returns bare query when no domain filters', () => {
    expect(buildSearchQuery({ query: 'Python asyncio tutorial' }))
      .toBe('Python asyncio tutorial')
  })

  test('appends site: filters for allowed_domains', () => {
    const result = buildSearchQuery({
      query: 'asyncio',
      allowed_domains: ['docs.python.org', 'realpython.com'],
    })
    expect(result).toBe('asyncio (site:docs.python.org OR site:realpython.com)')
  })

  test('appends -site: filters for blocked_domains', () => {
    const result = buildSearchQuery({
      query: 'asyncio',
      blocked_domains: ['pinterest.com', 'quora.com'],
    })
    expect(result).toBe('asyncio -site:pinterest.com -site:quora.com')
  })

  test('handles single allowed domain', () => {
    const result = buildSearchQuery({
      query: 'React hooks',
      allowed_domains: ['react.dev'],
    })
    expect(result).toBe('React hooks (site:react.dev)')
  })

  test('handles single blocked domain', () => {
    const result = buildSearchQuery({
      query: 'React hooks',
      blocked_domains: ['w3schools.com'],
    })
    expect(result).toBe('React hooks -site:w3schools.com')
  })

  test('ignores empty arrays', () => {
    const result = buildSearchQuery({
      query: 'test',
      allowed_domains: [],
      blocked_domains: [],
    })
    expect(result).toBe('test')
  })
})

describe('webSearchToolDef', () => {
  test('has correct name', () => {
    const def = webSearchToolDef()
    expect(def.name).toBe(WEB_SEARCH_TOOL_NAME)
  })

  test('is read-only', () => {
    const def = webSearchToolDef()
    expect(def.isReadOnly?.({} as WebSearchToolInput)).toBe(true)
  })

  test('is concurrency-safe', () => {
    const def = webSearchToolDef()
    expect(def.isConcurrencySafe?.({} as WebSearchToolInput)).toBe(true)
  })

  test('prompt references system date context', async () => {
    const def = webSearchToolDef()
    const prompt = await def.prompt()
    expect(prompt).toContain('current date')
    expect(prompt).toContain('Searches the web')
  })

  test('description includes query', async () => {
    const def = webSearchToolDef()
    const desc = await def.description({ query: 'Python asyncio', allowed_domains: undefined, blocked_domains: undefined })
    expect(desc).toContain('Python asyncio')
  })

  test('userFacingName shows query when present', () => {
    const def = webSearchToolDef()
    expect(def.userFacingName?.({ query: 'Python asyncio' })).toBe('WebSearch("Python asyncio")')
  })

  test('userFacingName truncates long queries', () => {
    const def = webSearchToolDef()
    const longQuery = 'a'.repeat(50)
    const name = def.userFacingName?.({ query: longQuery })
    expect(name).toBe(`WebSearch("${'a'.repeat(40)}...")`)
  })

  test('userFacingName returns bare name without query', () => {
    const def = webSearchToolDef()
    expect(def.userFacingName?.({})).toBe('WebSearch')
  })
})

describe('inputSchema validation', () => {
  test('accepts valid query', () => {
    const def = webSearchToolDef()
    const parsed = def.inputSchema.safeParse({ query: 'Python asyncio tutorial' })
    expect(parsed.success).toBe(true)
  })

  test('rejects query shorter than 2 characters', () => {
    const def = webSearchToolDef()
    expect(def.inputSchema.safeParse({ query: 'a' }).success).toBe(false)
    expect(def.inputSchema.safeParse({ query: '' }).success).toBe(false)
  })

  test('rejects missing query', () => {
    const def = webSearchToolDef()
    expect(def.inputSchema.safeParse({}).success).toBe(false)
  })

  test('accepts allowed_domains', () => {
    const def = webSearchToolDef()
    const parsed = def.inputSchema.safeParse({
      query: 'test query',
      allowed_domains: ['example.com'],
    })
    expect(parsed.success).toBe(true)
  })

  test('accepts blocked_domains', () => {
    const def = webSearchToolDef()
    const parsed = def.inputSchema.safeParse({
      query: 'test query',
      blocked_domains: ['example.com'],
    })
    expect(parsed.success).toBe(true)
  })

  test('rejects extra fields (strict)', () => {
    const def = webSearchToolDef()
    const parsed = def.inputSchema.safeParse({
      query: 'test query',
      extra: true,
    })
    expect(parsed.success).toBe(false)
  })
})

describe('validateInput', () => {
  test('rejects when both allowed_domains and blocked_domains are set', async () => {
    const def = webSearchToolDef()
    const result = await def.validateInput!(
      {
        query: 'test query',
        allowed_domains: ['example.com'],
        blocked_domains: ['other.com'],
      },
      makeContext(),
    )
    expect(result.result).toBe(false)
    if (!result.result) {
      expect(result.message).toContain('mutually exclusive')
    }
  })

  test('accepts when only allowed_domains is set', async () => {
    const def = webSearchToolDef()
    const result = await def.validateInput!(
      { query: 'test', allowed_domains: ['example.com'], blocked_domains: undefined },
      makeContext(),
    )
    expect(result.result).toBe(true)
  })

  test('accepts when only blocked_domains is set', async () => {
    const def = webSearchToolDef()
    const result = await def.validateInput!(
      { query: 'test', allowed_domains: undefined, blocked_domains: ['example.com'] },
      makeContext(),
    )
    expect(result.result).toBe(true)
  })

  test('accepts when neither domain filter is set', async () => {
    const def = webSearchToolDef()
    const result = await def.validateInput!(
      { query: 'test', allowed_domains: undefined, blocked_domains: undefined },
      makeContext(),
    )
    expect(result.result).toBe(true)
  })
})

describe('mapToolResultToToolResultBlockParam', () => {
  test('formats results with source reminder', () => {
    const def = webSearchToolDef()
    const param = def.mapToolResultToToolResultBlockParam(
      {
        query: 'Python asyncio',
        results: [
          { title: 'asyncio — Asynchronous I/O', url: 'https://docs.python.org/3/library/asyncio.html', snippet: 'asyncio is a library to write concurrent code' },
          { title: 'Real Python Async IO', url: 'https://realpython.com/async-io-python/', snippet: 'A comprehensive guide to async IO in Python' },
        ],
        durationMs: 0.3,
      },
      'test-id',
    )
    expect(param.type).toBe('tool_result')
    expect(param.tool_use_id).toBe('test-id')
    const content = param.content as string
    expect(content).toContain('Web search results for: "Python asyncio"')
    expect(content).toContain('1. asyncio — Asynchronous I/O')
    expect(content).toContain('URL: https://docs.python.org/3/library/asyncio.html')
    expect(content).toContain('2. Real Python Async IO')
    expect(content).toContain('REMINDER')
    expect(param).not.toHaveProperty('is_error')
  })

  test('formats empty results', () => {
    const def = webSearchToolDef()
    const param = def.mapToolResultToToolResultBlockParam(
      { query: 'xyznonexistent', results: [], durationMs: 0.2 },
      'test-id',
    )
    const content = param.content as string
    expect(content).toContain('No results found')
    expect(content).toContain('xyznonexistent')
  })

  test('formats error result with is_error flag', () => {
    const def = webSearchToolDef()
    const param = def.mapToolResultToToolResultBlockParam(
      {
        query: 'test',
        results: [],
        durationMs: 0,
        error: 'Brave Search API error: 429 Too Many Requests',
      },
      'test-id',
    )
    expect(param.is_error).toBe(true)
    const content = param.content as string
    expect(content).toContain('429')
  })
})
