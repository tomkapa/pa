import { z, type ZodType } from 'zod'
import type {
  ToolDef,
  ToolResultBlockParam,
  ToolUseContext,
  ValidationResult,
} from '../services/tools/types.js'
import { logForDebugging } from '../services/observability/debug.js'
import { getErrorMessage } from '../utils/error.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WebSearchToolInput {
  query: string
  allowed_domains?: string[]
  blocked_domains?: string[]
}

export interface WebSearchToolOutput {
  query: string
  results: Array<{
    title: string
    url: string
    snippet: string
  }>
  durationMs: number
  /** Present only when the search API itself returned an error. */
  error?: string
}

// ---------------------------------------------------------------------------
// Brave Search API response shape (only the fields we need)
// ---------------------------------------------------------------------------

interface BraveSearchResponse {
  web?: {
    results: Array<{
      title: string
      url: string
      description: string
    }>
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const WEB_SEARCH_TOOL_NAME = 'WebSearch'
const MAX_SEARCH_RESULTS = 10
const FETCH_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Query building — domain filtering via site: operators
// ---------------------------------------------------------------------------

export function buildSearchQuery(input: WebSearchToolInput): string {
  let query = input.query

  if (input.allowed_domains?.length) {
    const siteFilter = input.allowed_domains
      .map(d => `site:${d}`)
      .join(' OR ')
    query = `${query} (${siteFilter})`
  }

  if (input.blocked_domains?.length) {
    const excludeFilter = input.blocked_domains
      .map(d => `-site:${d}`)
      .join(' ')
    query = `${query} ${excludeFilter}`
  }

  return query
}

// ---------------------------------------------------------------------------
// Brave Search API call
// ---------------------------------------------------------------------------

async function searchBrave(
  query: string,
  signal?: AbortSignal,
): Promise<BraveSearchResponse> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) {
    throw new Error(
      'BRAVE_SEARCH_API_KEY not set. Get a free key at https://brave.com/search/api/',
    )
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(MAX_SEARCH_RESULTS))
  url.searchParams.set('text_decorations', 'false')

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
    signal,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `Brave Search API error: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
    )
  }

  return response.json() as Promise<BraveSearchResponse>
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function webSearchToolDef(): ToolDef<WebSearchToolInput, WebSearchToolOutput> {
  return {
    name: WEB_SEARCH_TOOL_NAME,
    shouldDefer: true,
    maxResultSizeChars: 100_000,

    get inputSchema(): ZodType<WebSearchToolInput> {
      return z.strictObject({
        query: z.string().min(2),
        allowed_domains: z.array(z.string()).optional(),
        blocked_domains: z.array(z.string()).optional(),
      }) as ZodType<WebSearchToolInput>
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,

    async prompt() {
      return (
        'Searches the web and returns results with titles, URLs, and snippets. ' +
        'Use for information beyond the model\'s knowledge cutoff. ' +
        'Domain filtering: use allowed_domains OR blocked_domains (not both). ' +
        'Use the current date (provided in the system prompt) when searching ' +
        'for recent information, documentation, or current events. ' +
        'After answering, include a "Sources:" section with markdown hyperlinks: ' +
        'Sources:\n  - [Title 1](https://...)\n  - [Title 2](https://...)'
      )
    },

    async description(input) {
      return `Search the web for "${input.query}"`
    },

    userFacingName(input) {
      if (input.query) {
        const q = input.query.length > 40 ? input.query.slice(0, 40) + '...' : input.query
        return `WebSearch("${q}")`
      }
      return 'WebSearch'
    },

    async validateInput(input: WebSearchToolInput, _context: ToolUseContext): Promise<ValidationResult> {
      if (input.allowed_domains?.length && input.blocked_domains?.length) {
        return {
          result: false,
          message: 'allowed_domains and blocked_domains are mutually exclusive — provide one or neither, not both.',
        }
      }
      return { result: true }
    },

    async call(input, context) {
      const startTime = Date.now()
      const searchQuery = buildSearchQuery(input)

      logForDebugging(`websearch_start: query="${searchQuery}"`, { level: 'info' })

      const timeoutController = new AbortController()
      const timeout = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS)
      const onParentAbort = () => timeoutController.abort()
      context.abortController.signal.addEventListener('abort', onParentAbort, { once: true })

      let response: BraveSearchResponse
      try {
        response = await searchBrave(searchQuery, timeoutController.signal)
      } catch (error: unknown) {
        const msg = getErrorMessage(error)
        logForDebugging(`websearch_error: query="${searchQuery}" error="${msg}"`, { level: 'error' })
        return {
          data: {
            query: input.query,
            results: [],
            durationMs: Math.round(Date.now() - startTime),
            error: msg,
          },
        }
      } finally {
        clearTimeout(timeout)
        context.abortController.signal.removeEventListener('abort', onParentAbort)
      }

      const results = (response.web?.results ?? []).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      }))

      const durationMs = Math.round(Date.now() - startTime)
      logForDebugging(
        `websearch_done: query="${input.query}" results=${results.length} durationMs=${durationMs}`,
        { level: 'info' },
      )

      return { data: { query: input.query, results, durationMs } }
    },

    mapToolResultToToolResultBlockParam(
      output: WebSearchToolOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      if (output.error) {
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUseID,
          content: `Web search failed: ${output.error}`,
          is_error: true,
        }
      }

      let text = `Web search results for: "${output.query}"\n\n`

      if (output.results.length === 0) {
        text += 'No results found.\n'
      } else {
        for (const [i, r] of output.results.entries()) {
          text += `${i + 1}. ${r.title}\n`
          text += `   URL: ${r.url}\n`
          text += `   ${r.snippet}\n\n`
        }
      }

      text +=
        '\nREMINDER: Include relevant sources in your response using markdown hyperlinks [Title](URL).'

      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: text.trim(),
      }
    },
  }
}
