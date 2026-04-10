import { z } from 'zod'
import type { ZodType } from 'zod'
import type { ToolDef, ToolResultBlockParam, Tool } from '../services/tools/types.js'
import type { QueryDeps } from '../services/agent/types.js'
import { query } from '../services/agent/query.js'
import { extractTextFromContent, createUserMessage } from '../services/messages/factory.js'
import { logForDebugging } from '../services/observability/debug.js'
import { getErrorMessage } from '../utils/error.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentToolInput {
  prompt: string
  description: string
}

export interface AgentToolOutput {
  status: 'completed' | 'error'
  content: string
  totalDurationMs: number
}

export interface CreateChildQueryDepsOptions {
  tools: Tool<unknown, unknown>[]
  abortController: AbortController
}

export interface AgentToolDeps {
  /**
   * Factory that builds QueryDeps for the child agent loop.
   * Injected by the REPL so the tool doesn't need direct access to the
   * Anthropic client or model config.
   */
  createChildQueryDeps: (options: CreateChildQueryDepsOptions) => QueryDeps
  /** The full tool list (mutable ref — child reads at call time). */
  tools: Tool<unknown, unknown>[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tools that must NOT be available to the child agent. */
export const CHILD_DISALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'Agent',         // prevent recursion
  'EnterPlanMode', // child shouldn't enter plan mode
  'ExitPlanMode',  // child shouldn't exit plan mode
])

export const CHILD_SYSTEM_PROMPT = [
  'You are a focused sub-agent spawned to handle a specific task.',
  'Complete the task thoroughly, then provide a concise summary of what you did and found.',
  'You have access to tools. Use them as needed.',
  'Do not ask clarifying questions — work with what you have.',
  'Keep your final response under 500 words — the caller only needs the key findings.',
].join('\n')

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Remove tools that are not safe or meaningful in a subagent context. */
export function filterToolsForChild(
  allTools: ReadonlyArray<Tool<unknown, unknown>>,
): Tool<unknown, unknown>[] {
  return allTools.filter(t => !CHILD_DISALLOWED_TOOLS.has(t.name))
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function agentToolDef(
  deps: AgentToolDeps,
): ToolDef<AgentToolInput, AgentToolOutput> {
  return {
    name: 'Agent',
    maxResultSizeChars: 50_000,

    get inputSchema(): ZodType<AgentToolInput> {
      return z.strictObject({
        prompt: z.string().describe('The task for the agent to perform'),
        description: z.string().describe('A short (3-5 word) description of the task'),
      }) as ZodType<AgentToolInput>
    },

    isReadOnly: () => false,
    isConcurrencySafe: () => false,

    async prompt() {
      return (
        'Launch a sub-agent to handle a complex, multi-step task. ' +
        'The sub-agent runs in its own context with its own message history and returns a summary.\n\n' +
        'Use it when:\n' +
        '- The task requires exploring many files (the sub-agent\'s context won\'t pollute yours)\n' +
        '- The task is independent enough to delegate (clear input, clear output)\n' +
        '- You need a "fresh pair of eyes" on a sub-problem\n\n' +
        'Don\'t use it for simple, quick operations — just do those yourself.'
      )
    },

    async description(input) {
      return `Agent: ${input.description}`
    },

    userFacingName(input) {
      return input.description ? `Agent(${input.description})` : 'Agent'
    },

    async call(input, context) {
      const { prompt, description } = input
      const startTime = Date.now()

      const childAbort = new AbortController()
      const onParentAbort = () => childAbort.abort()
      context.abortController.signal.addEventListener('abort', onParentAbort, { once: true })

      try {
        const childTools = filterToolsForChild(deps.tools)
        const childDeps = deps.createChildQueryDeps({
          tools: childTools,
          abortController: childAbort,
        })

        const initialMessage = createUserMessage({ content: prompt })

        logForDebugging(`agent_spawn: description="${description}"`, { level: 'info' })

        let lastAssistantText = ''
        for await (const event of query({
          messages: [initialMessage],
          systemPrompt: [CHILD_SYSTEM_PROMPT],
          abortSignal: childAbort.signal,
          deps: childDeps,
        })) {
          if (event.type === 'assistant') {
            lastAssistantText = extractTextFromContent(event.message.content)
          }
        }

        const content = lastAssistantText.length > 0 ? lastAssistantText : '(no response)'
        const totalDurationMs = Date.now() - startTime

        logForDebugging(
          `agent_done: description="${description}" durationMs=${totalDurationMs}`,
          { level: 'info' },
        )

        return {
          data: { status: 'completed', content, totalDurationMs },
        }
      } catch (error: unknown) {
        // Let abort errors propagate so the parent query loop handles them.
        if (childAbort.signal.aborted) throw error

        const totalDurationMs = Date.now() - startTime
        const errorMsg = getErrorMessage(error)

        logForDebugging(
          `agent_error: description="${description}" error="${errorMsg}"`,
          { level: 'error' },
        )

        return {
          data: { status: 'error', content: `Sub-agent error: ${errorMsg}`, totalDurationMs },
        }
      } finally {
        context.abortController.signal.removeEventListener('abort', onParentAbort)
      }
    },

    mapToolResultToToolResultBlockParam(
      output: AgentToolOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: output.content,
        ...(output.status === 'error' ? { is_error: true } : {}),
      }
    },
  }
}
