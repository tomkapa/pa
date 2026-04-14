import { describe, expect, test } from 'bun:test'
import {
  validateURL,
  isPermittedRedirect,
  truncateContent,
  webFetchToolDef,
  WEB_FETCH_TOOL_NAME,
  WebFetchErrorCode,
  type WebFetchToolInput,
  type WebFetchToolOutput,
  type WebFetchToolDeps,
} from '../tools/webFetchTool.js'
import { buildTool } from '../services/tools/index.js'
import { makeContext } from '../testing/make-context.js'

const fakeDeps: WebFetchToolDeps = {
  summarize: async (md) => md,
}

describe('validateURL', () => {
  test('accepts valid https URL', () => {
    const result = validateURL('https://docs.python.org/3/library/json.html')
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.normalized).toBe('https://docs.python.org/3/library/json.html')
    }
  })

  test('auto-upgrades http to https', () => {
    const result = validateURL('http://example.com/page')
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.normalized).toContain('https://')
    }
  })

  test('rejects URLs exceeding max length', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(2000)
    const result = validateURL(longUrl)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('maximum length')
    }
  })

  test('rejects invalid URLs', () => {
    const result = validateURL('not-a-url')
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('Invalid URL')
    }
  })

  test('rejects URLs with embedded credentials', () => {
    const result = validateURL('https://user:pass@example.com')
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('credentials')
    }
  })

  test('rejects single-label hostnames', () => {
    const result = validateURL('https://localhost/path')
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('two parts')
    }
  })

  test('rejects non-http/https protocols', () => {
    const result = validateURL('ftp://files.example.com/file.txt')
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('https')
    }
  })

  test('accepts URL with port', () => {
    const result = validateURL('https://example.com:8080/path')
    expect(result.valid).toBe(true)
  })

  test('accepts URL with query and fragment', () => {
    const result = validateURL('https://example.com/page?q=test#section')
    expect(result.valid).toBe(true)
  })
})

describe('isPermittedRedirect', () => {
  test('allows same-host redirect', () => {
    expect(isPermittedRedirect(
      'https://example.com/old',
      'https://example.com/new',
    )).toBe(true)
  })

  test('allows www to non-www redirect', () => {
    expect(isPermittedRedirect(
      'https://www.example.com/old',
      'https://example.com/new',
    )).toBe(true)
  })

  test('allows non-www to www redirect', () => {
    expect(isPermittedRedirect(
      'https://example.com/old',
      'https://www.example.com/new',
    )).toBe(true)
  })

  test('blocks cross-host redirect', () => {
    expect(isPermittedRedirect(
      'https://example.com/old',
      'https://evil.com/phish',
    )).toBe(false)
  })

  test('blocks protocol downgrade', () => {
    expect(isPermittedRedirect(
      'https://example.com/old',
      'http://example.com/new',
    )).toBe(false)
  })

  test('blocks redirect with credentials', () => {
    expect(isPermittedRedirect(
      'https://example.com/old',
      'https://user:pass@example.com/new',
    )).toBe(false)
  })

  test('blocks different port', () => {
    expect(isPermittedRedirect(
      'https://example.com/old',
      'https://example.com:8080/new',
    )).toBe(false)
  })

  test('handles invalid URLs gracefully', () => {
    expect(isPermittedRedirect('not-a-url', 'https://example.com')).toBe(false)
    expect(isPermittedRedirect('https://example.com', 'not-a-url')).toBe(false)
  })
})

describe('truncateContent', () => {
  test('returns short content unchanged', () => {
    const content = 'Hello world'
    expect(truncateContent(content)).toBe(content)
  })

  test('truncates content exceeding limit', () => {
    const content = 'x'.repeat(200_000)
    const result = truncateContent(content)
    expect(result.length).toBeLessThan(content.length)
    expect(result).toContain('[Content truncated due to length...]')
  })

  test('does not truncate content at exactly the limit', () => {
    const content = 'x'.repeat(100_000)
    expect(truncateContent(content)).toBe(content)
  })
})

describe('webFetchToolDef', () => {
  test('has correct name', () => {
    const def = webFetchToolDef(fakeDeps)
    expect(def.name).toBe(WEB_FETCH_TOOL_NAME)
  })

  test('is read-only', () => {
    const def = webFetchToolDef(fakeDeps)
    expect(def.isReadOnly?.({} as WebFetchToolInput)).toBe(true)
  })

  test('is concurrency-safe', () => {
    const def = webFetchToolDef(fakeDeps)
    expect(def.isConcurrencySafe?.({} as WebFetchToolInput)).toBe(true)
  })

  test('prompt returns non-empty string', async () => {
    const def = webFetchToolDef(fakeDeps)
    const prompt = await def.prompt()
    expect(prompt.length).toBeGreaterThan(0)
    expect(prompt).toContain('Fetch')
  })

  test('description includes URL', async () => {
    const def = webFetchToolDef(fakeDeps)
    const desc = await def.description({ url: 'https://example.com', prompt: 'test' })
    expect(desc).toContain('https://example.com')
  })

  test('userFacingName shows hostname', () => {
    const def = webFetchToolDef(fakeDeps)
    const name = def.userFacingName?.({ url: 'https://docs.python.org/3/library/json.html' })
    expect(name).toBe('WebFetch(docs.python.org)')
  })

  test('userFacingName handles missing url', () => {
    const def = webFetchToolDef(fakeDeps)
    const name = def.userFacingName?.({})
    expect(name).toBe('WebFetch')
  })

  test('checkPermissions asks with domain suggestion', async () => {
    const def = webFetchToolDef(fakeDeps)
    const result = await def.checkPermissions!(
      { url: 'https://docs.python.org/3/', prompt: 'test' },
      makeContext(),
    )
    expect(result.behavior).toBe('ask')
    if (result.behavior === 'ask') {
      expect(result.message).toContain('docs.python.org')
      expect(result.suggestions).toHaveLength(1)
      expect(result.suggestions?.[0]?.ruleValue).toBe('WebFetch:domain:docs.python.org')
    }
  })

  test('validateInput rejects invalid URL', async () => {
    const def = webFetchToolDef(fakeDeps)
    const result = await def.validateInput!(
      { url: 'not-a-url', prompt: 'test' },
      makeContext(),
    )
    expect(result.result).toBe(false)
    if (!result.result) {
      expect(result.message).toContain('Invalid URL')
    }
  })

  test('validateInput accepts valid URL', async () => {
    const def = webFetchToolDef(fakeDeps)
    const result = await def.validateInput!(
      { url: 'https://example.com', prompt: 'test' },
      makeContext(),
    )
    expect(result.result).toBe(true)
  })

  test('inputSchema validates correct input', () => {
    const def = webFetchToolDef(fakeDeps)
    const parsed = def.inputSchema.safeParse({
      url: 'https://example.com',
      prompt: 'What is this?',
    })
    expect(parsed.success).toBe(true)
  })

  test('inputSchema rejects missing fields', () => {
    const def = webFetchToolDef(fakeDeps)
    expect(def.inputSchema.safeParse({ url: 'https://example.com' }).success).toBe(false)
    expect(def.inputSchema.safeParse({ prompt: 'test' }).success).toBe(false)
  })

  test('inputSchema rejects extra fields', () => {
    const def = webFetchToolDef(fakeDeps)
    const parsed = def.inputSchema.safeParse({
      url: 'https://example.com',
      prompt: 'test',
      extra: true,
    })
    expect(parsed.success).toBe(false)
  })
})

describe('webFetchTool call — URL validation', () => {
  test('returns validation error for invalid URL', async () => {
    const tool = buildTool(webFetchToolDef(fakeDeps))
    const result = await tool.call(
      { url: 'not-a-url', prompt: 'test' },
      makeContext(),
    )
    expect(result.data.code).toBe(0)
    expect(result.data.codeText).toBe(WebFetchErrorCode.VALIDATION)
    expect(result.data.result).toContain('Invalid URL')
  })

  test('returns validation error for localhost', async () => {
    const tool = buildTool(webFetchToolDef(fakeDeps))
    const result = await tool.call(
      { url: 'https://localhost/path', prompt: 'test' },
      makeContext(),
    )
    expect(result.data.code).toBe(0)
    expect(result.data.codeText).toBe(WebFetchErrorCode.VALIDATION)
    expect(result.data.result).toContain('two parts')
  })

  test('returns validation error for credentials in URL', async () => {
    const tool = buildTool(webFetchToolDef(fakeDeps))
    const result = await tool.call(
      { url: 'https://user:pass@example.com', prompt: 'test' },
      makeContext(),
    )
    expect(result.data.codeText).toBe(WebFetchErrorCode.VALIDATION)
    expect(result.data.result).toContain('credentials')
  })
})

describe('mapToolResultToToolResultBlockParam', () => {
  test('formats successful 200 result without prefix', () => {
    const def = webFetchToolDef(fakeDeps)
    const output: WebFetchToolOutput = {
      bytes: 5000,
      code: 200,
      codeText: 'OK',
      result: 'The page contains info about JSON.',
      durationMs: 1500,
      url: 'https://example.com',
    }
    const param = def.mapToolResultToToolResultBlockParam(output, 'test-id')
    expect(param.type).toBe('tool_result')
    expect(param.tool_use_id).toBe('test-id')
    expect(param.content).toBe('The page contains info about JSON.')
    expect(param).not.toHaveProperty('is_error')
  })

  test('formats 201 result without prefix (2xx should not get prefix)', () => {
    const def = webFetchToolDef(fakeDeps)
    const output: WebFetchToolOutput = {
      bytes: 100,
      code: 201,
      codeText: 'Created',
      result: 'Resource created.',
      durationMs: 200,
      url: 'https://example.com/resource',
    }
    const param = def.mapToolResultToToolResultBlockParam(output, 'test-id')
    expect(param.content).toBe('Resource created.')
    expect(param).not.toHaveProperty('is_error')
  })

  test('formats 404 error with is_error flag', () => {
    const def = webFetchToolDef(fakeDeps)
    const output: WebFetchToolOutput = {
      bytes: 100,
      code: 404,
      codeText: 'Not Found',
      result: 'HTTP 404 Not Found',
      durationMs: 200,
      url: 'https://example.com/missing',
    }
    const param = def.mapToolResultToToolResultBlockParam(output, 'test-id')
    expect(param.content).toContain('[HTTP 404 Not Found]')
    expect(param.is_error).toBe(true)
  })

  test('formats redirect result with prefix but no is_error', () => {
    const def = webFetchToolDef(fakeDeps)
    const output: WebFetchToolOutput = {
      bytes: 0,
      code: 301,
      codeText: 'Moved Permanently',
      result: 'Cross-host redirect detected.',
      durationMs: 100,
      url: 'https://example.com',
    }
    const param = def.mapToolResultToToolResultBlockParam(output, 'test-id')
    expect(param.content).toContain('[HTTP 301')
    expect(param).not.toHaveProperty('is_error')
  })

  test('does not prefix code 0 results', () => {
    const def = webFetchToolDef(fakeDeps)
    const output: WebFetchToolOutput = {
      bytes: 0,
      code: 0,
      codeText: WebFetchErrorCode.VALIDATION,
      result: 'Invalid URL',
      durationMs: 1,
      url: 'bad',
    }
    const param = def.mapToolResultToToolResultBlockParam(output, 'test-id')
    expect(param.content).toBe('Invalid URL')
  })
})
