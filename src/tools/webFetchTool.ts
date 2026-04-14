import type Anthropic from '@anthropic-ai/sdk'
import { z, type ZodType } from 'zod'
import type {
  ToolDef,
  ToolResultBlockParam,
  ToolUseContext,
  PermissionResult,
  ValidationResult,
} from '../services/tools/types.js'
import { queryWithoutStreaming } from '../services/api/query.js'
import { extractTextFromContent } from '../services/messages/factory.js'
import { logForDebugging } from '../services/observability/debug.js'
import { getErrorMessage } from '../utils/error.js'

export interface WebFetchToolInput {
  url: string
  prompt: string
}

export interface WebFetchToolOutput {
  bytes: number
  code: number
  codeText: string
  result: string
  durationMs: number
  url: string
}

/**
 * Injected summarizer — decouples the tool from the Anthropic SDK.
 * The REPL wires this to a real API call; tests inject a stub.
 */
export type WebFetchSummarizeFn = (
  markdown: string,
  prompt: string,
  signal: AbortSignal,
) => Promise<string>

export interface WebFetchToolDeps {
  summarize: WebFetchSummarizeFn
}

const MAX_URL_LENGTH = 2000
const MAX_REDIRECTS = 10
const FETCH_TIMEOUT_MS = 60_000
const MAX_CONTENT_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_MARKDOWN_LENGTH = 100_000
const SKIP_SUMMARIZE_THRESHOLD = 10_000
const USER_AGENT = 'PaAgent/1.0'
/** Conservative upper bound: 4 bytes per UTF-8 char */
const DECODE_SLICE_BYTES = MAX_MARKDOWN_LENGTH * 4

export const WEB_FETCH_TOOL_NAME = 'WebFetch'

export const WebFetchErrorCode = {
  VALIDATION: 'VALIDATION_ERROR',
  FETCH: 'FETCH_ERROR',
} as const

export type URLValidationResult =
  | { valid: true; normalized: string }
  | { valid: false; reason: string }

export function validateURL(raw: string): URLValidationResult {
  if (raw.length > MAX_URL_LENGTH) {
    return { valid: false, reason: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters` }
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { valid: false, reason: `Invalid URL: ${raw}` }
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'URLs with embedded credentials are not allowed' }
  }

  if (parsed.hostname.split('.').length < 2) {
    return { valid: false, reason: `Hostname must have at least two parts (got "${parsed.hostname}")` }
  }

  if (parsed.protocol === 'http:') {
    parsed.protocol = 'https:'
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: `Only https URLs are supported (got "${parsed.protocol}")` }
  }

  return { valid: true, normalized: parsed.toString() }
}

export function isPermittedRedirect(originalUrl: string, redirectUrl: string): boolean {
  let orig: URL
  let redir: URL
  try {
    orig = new URL(originalUrl)
    redir = new URL(redirectUrl)
  } catch {
    return false
  }

  if (redir.protocol !== orig.protocol) return false
  if (redir.port !== orig.port) return false
  if (redir.username || redir.password) return false

  const stripWww = (h: string) => h.replace(/^www\./, '')
  return stripWww(orig.hostname) === stripWww(redir.hostname)
}

interface FetchResult {
  body: ArrayBuffer
  status: number
  statusText: string
  contentType: string
  finalUrl: string
  redirectedCrossHost?: { location: string }
}

async function fetchWithRedirects(
  url: string,
  signal: AbortSignal,
  depth: number = 0,
): Promise<FetchResult> {
  if (depth > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (>${MAX_REDIRECTS})`)
  }

  const response = await fetch(url, {
    redirect: 'manual',
    signal,
    headers: {
      'Accept': 'text/markdown, text/html, */*',
      'User-Agent': USER_AGENT,
    },
  })

  const status = response.status
  if (status >= 300 && status < 400) {
    const location = response.headers.get('location')
    if (!location) {
      throw new Error(`Redirect response (${status}) missing Location header`)
    }

    const resolvedLocation = new URL(location, url).toString()

    if (isPermittedRedirect(url, resolvedLocation)) {
      return fetchWithRedirects(resolvedLocation, signal, depth + 1)
    }

    await response.body?.cancel().catch(() => {})
    return {
      body: new ArrayBuffer(0),
      status,
      statusText: response.statusText,
      contentType: '',
      finalUrl: url,
      redirectedCrossHost: { location: resolvedLocation },
    }
  }

  const contentLength = response.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_CONTENT_BYTES) {
    await response.body?.cancel().catch(() => {})
    throw new Error(
      `Response too large: ${contentLength} bytes exceeds ${MAX_CONTENT_BYTES} byte limit`,
    )
  }

  const body = await response.arrayBuffer()
  if (body.byteLength > MAX_CONTENT_BYTES) {
    throw new Error(
      `Response too large: ${body.byteLength} bytes exceeds ${MAX_CONTENT_BYTES} byte limit`,
    )
  }

  return {
    body,
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get('content-type') ?? '',
    finalUrl: url,
  }
}

let turndownPromise: Promise<import('turndown')> | undefined

function getTurndownService(): Promise<import('turndown')> {
  return (turndownPromise ??= import('turndown').then(m => {
    return new m.default({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  }).catch(err => {
    turndownPromise = undefined
    throw err
  }))
}

function isHTMLContent(contentType: string): boolean {
  return contentType.includes('text/html') || contentType.includes('application/xhtml')
}

function isTextContent(contentType: string): boolean {
  return (
    contentType.includes('text/') ||
    contentType.includes('application/json') ||
    contentType.includes('application/xml') ||
    contentType.includes('application/javascript')
  )
}

async function convertToMarkdown(body: ArrayBuffer, contentType: string): Promise<string> {
  // Decode only the bytes we'll actually use — avoids creating a 10 MB string
  // from a large response that will be truncated to 100K chars anyway.
  const slice = body.byteLength > DECODE_SLICE_BYTES
    ? body.slice(0, DECODE_SLICE_BYTES)
    : body
  const text = new TextDecoder().decode(slice)

  if (isHTMLContent(contentType)) {
    const turndown = await getTurndownService()
    return turndown.turndown(text)
  }

  return text
}

export function truncateContent(content: string): string {
  if (content.length <= MAX_MARKDOWN_LENGTH) return content
  return content.slice(0, MAX_MARKDOWN_LENGTH) + '\n\n[Content truncated due to length...]'
}

function makeSummarizationPrompt(markdownContent: string, userPrompt: string): string {
  return [
    'Web page content:',
    '---',
    markdownContent,
    '---',
    '',
    userPrompt,
    '',
    'Provide a concise response based on the content above. Include relevant details, code examples, and documentation excerpts as needed.',
  ].join('\n')
}

/**
 * Build a WebFetchSummarizeFn backed by a real Anthropic client.
 * Short content (≤ SKIP_SUMMARIZE_THRESHOLD) is returned as-is.
 */
export function createWebFetchSummarizer(
  client: Anthropic,
  model: string,
  maxTokens: number,
): WebFetchSummarizeFn {
  return async (markdown, prompt, signal) => {
    if (markdown.length <= SKIP_SUMMARIZE_THRESHOLD) {
      return markdown
    }

    const result = await queryWithoutStreaming(client, {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: makeSummarizationPrompt(markdown, prompt) }],
      abortSignal: signal,
    })

    const text = extractTextFromContent(result.message.content)
    return text.trim().length > 0 ? text : markdown
  }
}

/** Build a result object — shared by all return paths in call(). */
function makeResult(
  startTime: number,
  fields: Partial<WebFetchToolOutput> & Pick<WebFetchToolOutput, 'result'>,
): { data: WebFetchToolOutput } {
  return {
    data: {
      bytes: 0,
      code: 0,
      codeText: '',
      url: '',
      ...fields,
      durationMs: Math.round(Date.now() - startTime),
    },
  }
}

export function webFetchToolDef(
  deps: WebFetchToolDeps,
): ToolDef<WebFetchToolInput, WebFetchToolOutput> {
  return {
    name: WEB_FETCH_TOOL_NAME,
    maxResultSizeChars: 100_000,

    get inputSchema(): ZodType<WebFetchToolInput> {
      return z.strictObject({
        url: z.string(),
        prompt: z.string(),
      }) as ZodType<WebFetchToolInput>
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,

    async prompt() {
      return (
        'Fetches a URL, converts the content to markdown, and summarizes it based on a prompt. ' +
        'Use this when you need to read web pages, documentation, or online resources. ' +
        'Provide a specific prompt describing what information to extract from the page. ' +
        'The tool fetches the URL, converts HTML to markdown, and returns a focused summary. ' +
        'Only https URLs with valid hostnames are supported. ' +
        'Cross-host redirects are reported back rather than auto-followed for security.'
      )
    },

    async description(input) {
      return `Fetch ${input.url}`
    },

    userFacingName(input) {
      if (input.url) {
        try {
          return `WebFetch(${new URL(input.url).hostname})`
        } catch {
          // fall through
        }
      }
      return 'WebFetch'
    },

    async validateInput(input: WebFetchToolInput, _context: ToolUseContext): Promise<ValidationResult> {
      const result = validateURL(input.url)
      if (!result.valid) {
        return { result: false, message: result.reason }
      }
      return { result: true }
    },

    async checkPermissions(input): Promise<PermissionResult> {
      let hostname: string
      try {
        hostname = new URL(input.url).hostname
      } catch {
        return { behavior: 'passthrough' }
      }

      return {
        behavior: 'ask',
        reason: { type: 'toolSpecific', description: `Fetch from ${hostname}` },
        message: `Allow WebFetch to access ${hostname}?`,
        suggestions: [
          {
            ruleValue: `WebFetch:domain:${hostname}`,
            description: `Always allow fetching from ${hostname}`,
          },
        ],
      }
    },

    async call(input, context) {
      const startTime = Date.now()

      const validation = validateURL(input.url)
      if (!validation.valid) {
        return makeResult(startTime, {
          codeText: WebFetchErrorCode.VALIDATION,
          result: validation.reason,
          url: input.url,
        })
      }
      const url = validation.normalized

      logForDebugging(`webfetch_start: url="${url}" prompt="${input.prompt.slice(0, 80)}"`, {
        level: 'info',
      })

      let fetchResult: FetchResult
      try {
        const timeoutController = new AbortController()
        const timeout = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS)
        const onParentAbort = () => timeoutController.abort()
        context.abortController.signal.addEventListener('abort', onParentAbort, { once: true })

        try {
          fetchResult = await fetchWithRedirects(url, timeoutController.signal)
        } finally {
          clearTimeout(timeout)
          context.abortController.signal.removeEventListener('abort', onParentAbort)
        }
      } catch (error: unknown) {
        const msg = getErrorMessage(error)
        logForDebugging(`webfetch_error: url="${url}" error="${msg}"`, { level: 'error' })
        return makeResult(startTime, {
          codeText: WebFetchErrorCode.FETCH,
          result: `Failed to fetch ${url}: ${msg}`,
          url,
        })
      }

      if (fetchResult.redirectedCrossHost) {
        const location = fetchResult.redirectedCrossHost.location
        logForDebugging(
          `webfetch_cross_host_redirect: from="${url}" to="${location}"`,
          { level: 'info' },
        )
        return makeResult(startTime, {
          code: fetchResult.status,
          codeText: fetchResult.statusText || 'REDIRECT',
          result: `Cross-host redirect detected. The server redirected to: ${location}\n\nTo follow this redirect, make a new WebFetch call with the redirect URL.`,
          url,
        })
      }

      if (fetchResult.status >= 400) {
        let errorBody = ''
        try {
          errorBody = new TextDecoder().decode(fetchResult.body).slice(0, 1000)
        } catch { /* ignore decode errors */ }
        logForDebugging(
          `webfetch_http_error: url="${url}" status=${fetchResult.status}`,
          { level: 'warn' },
        )
        return makeResult(startTime, {
          bytes: fetchResult.body.byteLength,
          code: fetchResult.status,
          codeText: fetchResult.statusText,
          result: `HTTP ${fetchResult.status} ${fetchResult.statusText}${errorBody ? `\n\n${errorBody}` : ''}`,
          url: fetchResult.finalUrl,
        })
      }

      if (!isTextContent(fetchResult.contentType) && !isHTMLContent(fetchResult.contentType)) {
        return makeResult(startTime, {
          bytes: fetchResult.body.byteLength,
          code: fetchResult.status,
          codeText: fetchResult.statusText,
          result: `Non-text content type: ${fetchResult.contentType} (${fetchResult.body.byteLength} bytes). Binary content cannot be summarized.`,
          url: fetchResult.finalUrl,
        })
      }

      let markdown: string
      try {
        markdown = await convertToMarkdown(fetchResult.body, fetchResult.contentType)
      } catch (error: unknown) {
        return makeResult(startTime, {
          bytes: fetchResult.body.byteLength,
          code: fetchResult.status,
          codeText: fetchResult.statusText,
          result: `Failed to convert content to markdown: ${getErrorMessage(error)}`,
          url: fetchResult.finalUrl,
        })
      }

      let result: string
      try {
        result = await deps.summarize(
          truncateContent(markdown),
          input.prompt,
          context.abortController.signal,
        )
      } catch (error: unknown) {
        logForDebugging(`webfetch_summarize_error: url="${url}" error="${getErrorMessage(error)}"`, { level: 'error' })
        result = truncateContent(markdown)
      }

      logForDebugging(
        `webfetch_done: url="${url}" bytes=${fetchResult.body.byteLength} durationMs=${Date.now() - startTime}`,
        { level: 'info' },
      )

      return makeResult(startTime, {
        bytes: fetchResult.body.byteLength,
        code: fetchResult.status,
        codeText: fetchResult.statusText,
        result,
        url: fetchResult.finalUrl,
      })
    },

    mapToolResultToToolResultBlockParam(
      output: WebFetchToolOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      let content = output.result

      const isNon2xx = output.code > 0 && (output.code < 200 || output.code >= 300)
      if (isNon2xx) {
        content = `[HTTP ${output.code} ${output.codeText}] ${content}`
      }

      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content,
        ...(output.code >= 400 ? { is_error: true } : {}),
      }
    },
  }
}
