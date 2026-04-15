import { z, type ZodType } from 'zod'
import type {
  ToolDef,
  ToolResultBlockParam,
  Tool,
} from '../services/tools/types.js'
import { isDeferredTool } from '../services/tools/deferred-tools.js'
import { toolInputToJsonSchema } from '../services/tools/to-api-tools.js'
import { semanticNumber } from '../utils/schema.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ToolSearchInput {
  query: string
  max_results: number
}

/** A resolved match: tool reference + its preloaded description. */
interface ResolvedMatch {
  tool: Tool<unknown, unknown>
  description: string
}

export interface ToolSearchOutput {
  resolvedMatches: ResolvedMatch[]
  query: string
  totalDeferred: number
}

/** Type guard for detecting ToolSearch results in the execution layer. */
export function isToolSearchOutput(value: unknown): value is ToolSearchOutput {
  return (
    typeof value === 'object' &&
    value !== null &&
    'resolvedMatches' in value &&
    Array.isArray((value as ToolSearchOutput).resolvedMatches)
  )
}

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const inputSchema = z.strictObject({
  query: z.string().describe(
    'Query to find deferred tools. Use "select:<tool_name>" for direct selection, or keywords to search.',
  ),
  max_results: semanticNumber(z.number().optional().default(5)).describe(
    'Maximum number of results to return (default: 5)',
  ),
})

// ---------------------------------------------------------------------------
// Search logic
// ---------------------------------------------------------------------------

interface SearchResult {
  matches: Tool<unknown, unknown>[]
  deferredCount: number
}

function searchTools(
  input: ToolSearchInput,
  allTools: Tool<unknown, unknown>[],
): SearchResult {
  const maxResults = input.max_results
  const deferred = allTools.filter(isDeferredTool)
  const deferredCount = deferred.length

  // Direct select mode: "select:ToolName" or "select:A,B,C"
  const selectMatch = input.query.match(/^select:(.+)$/i)
  if (selectMatch) {
    const requested = selectMatch[1]!.split(',').map(s => s.trim()).filter(Boolean)
    // Direct select searches ALL tools (including non-deferred) so the model
    // can load tools by exact name even if they wouldn't normally be deferred.
    return {
      matches: requested
        .map(name => allTools.find(t => t.name.toLowerCase() === name.toLowerCase()))
        .filter((t): t is Tool<unknown, unknown> => t !== undefined),
      deferredCount,
    }
  }

  const queryLower = input.query.toLowerCase()
  const terms = queryLower.split(/\s+/).filter(t => t.length > 0)

  // Exact name match fast path
  const exactMatch = deferred.find(t => t.name.toLowerCase() === queryLower)
  if (exactMatch) return { matches: [exactMatch], deferredCount }

  // MCP prefix match (e.g., "mcp__slack" matches all slack tools)
  if (queryLower.startsWith('mcp__')) {
    return {
      matches: deferred
        .filter(t => t.name.toLowerCase().startsWith(queryLower))
        .slice(0, maxResults),
      deferredCount,
    }
  }

  // "+term rest" syntax: require "term" in the name, rank by remaining terms
  let requiredTerm: string | undefined
  let scoringTerms = terms
  if (terms.length > 0 && terms[0]!.startsWith('+')) {
    requiredTerm = terms[0]!.slice(1)
    scoringTerms = terms.slice(1)
  }

  // Score by substring match count on tool name parts
  const scored = deferred.map(tool => {
    const nameLower = tool.name.toLowerCase()

    // Check required term first
    if (requiredTerm && !nameLower.includes(requiredTerm)) {
      return { tool, score: 0 }
    }

    const nameParts = nameLower
      .replace(/([a-z])([A-Z])/g, '$1 $2') // CamelCase split
      .replace(/__/g, ' ')
      .replace(/_/g, ' ')
      .split(/\s+/)

    let score = requiredTerm ? 1 : 0 // Base score for matching required term

    for (const term of scoringTerms.length > 0 ? scoringTerms : terms) {
      if (nameParts.includes(term)) score += 10      // exact part match
      else if (nameParts.some(p => p.includes(term))) score += 5 // partial
      else if (nameLower.includes(term)) score += 3  // full name fallback
    }

    return { tool, score }
  })

  return {
    matches: scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(s => s.tool),
    deferredCount,
  }
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

function formatResultText(output: ToolSearchOutput): string {
  if (output.resolvedMatches.length === 0) {
    return `No matching deferred tools found for query "${output.query}". ${output.totalDeferred} deferred tools available.`
  }

  // Format matched tools in <functions> block — same format the model sees
  // at the top of its prompt for tool definitions. This makes the schemas
  // immediately recognizable and usable by the model.
  const functionDefs = output.resolvedMatches.map(({ tool, description }) => {
    const schema = toolInputToJsonSchema(tool)
    return `<function>${JSON.stringify({ description, name: tool.name, parameters: schema })}</function>`
  }).join('\n')

  return [
    `Found ${output.resolvedMatches.length} matching tools.`,
    '',
    '<functions>',
    functionDefs,
    '</functions>',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function toolSearchToolDef(): ToolDef<ToolSearchInput, ToolSearchOutput> {
  return {
    name: 'ToolSearch',
    shouldDefer: false, // Never defer — bootstrapping tool
    maxResultSizeChars: 50_000,

    get inputSchema(): ZodType<ToolSearchInput> {
      // z.preprocess (used by semanticNumber) produces ZodEffects whose
      // _input type is unknown. The cast is safe — runtime validation is exact.
      return inputSchema as ZodType<ToolSearchInput>
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,

    async prompt() {
      return [
        'Fetches full schema definitions for deferred tools so they can be called.',
        '',
        'Deferred tools appear by name in <system-reminder> messages. Until fetched, only the name is known \u2014 there is no parameter schema, so the tool cannot be invoked. This tool takes a query, matches it against the deferred tool list, and returns the matched tools\' complete JSONSchema definitions inside a <functions> block. Once a tool\'s schema appears in that result, it is callable exactly like any tool defined at the top of the prompt.',
        '',
        'Result format: each matched tool appears as one <function>{"description": "...", "name": "...", "parameters": {...}}</function> line inside the <functions> block \u2014 the same encoding as the tool list at the top of this prompt.',
        '',
        'Query forms:',
        '- "select:Read,Edit,Grep" \u2014 fetch these exact tools by name',
        '- "notebook jupyter" \u2014 keyword search, up to max_results best matches',
        '- "+slack send" \u2014 require "slack" in the name, rank by remaining terms',
      ].join('\n')
    },

    async description() {
      return 'Search for and load deferred tool schemas'
    },

    async call(input, context) {
      const { matches, deferredCount } = searchTools(input, context.options.tools)

      // Resolve descriptions in parallel (prompt() is async)
      const resolvedMatches = await Promise.all(
        matches.map(async (tool) => ({
          tool,
          description: await tool.prompt(),
        })),
      )

      return {
        data: {
          resolvedMatches,
          query: input.query,
          totalDeferred: deferredCount,
        },
      }
    },

    mapToolResultToToolResultBlockParam(
      output: ToolSearchOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: formatResultText(output),
      }
    },
  }
}
