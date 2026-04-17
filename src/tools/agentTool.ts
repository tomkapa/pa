import { z } from 'zod'
import type { ZodType } from 'zod'
import type { ToolDef, ToolResultBlockParam, Tool } from '../services/tools/types.js'
import type { QueryDeps } from '../services/agent/types.js'
import type { AgentRegistry } from '../services/agents/registry.js'
import type { PermissionMode } from '../services/permissions/types.js'
import { resolveAgentTools } from '../services/agents/resolve-tools.js'
import { query } from '../services/agent/query.js'
import { extractTextFromContent, createUserMessage } from '../services/messages/factory.js'
import { logForDebugging } from '../services/observability/debug.js'
import { getErrorMessage } from '../utils/error.js'
import { spawnTeammate } from '../services/teams/index.js'
import {
  renderToolUseProgressMessage,
  type AgentProgress,
  type AgentActivityEntry,
} from './agentToolUI.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentToolInput {
  prompt: string
  description: string
  subagent_type?: string
  /** Teammate name (requires `team_name` — routes to subprocess spawning). */
  name?: string
  /** Target team (requires `name`). When set, spawn as a teammate process. */
  team_name?: string
  /** Optional model override passed to the teammate subprocess. */
  model?: string
}

export interface AgentToolOutput {
  status: 'completed' | 'error' | 'spawned'
  content: string
  totalDurationMs: number
  agentId?: string
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
  /** Agent registry for resolving subagent_type to agent definitions. */
  agentRegistry?: AgentRegistry
  /** Current permission mode — teammates inherit this by default. */
  getPermissionMode?: () => PermissionMode
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
        subagent_type: z.string().optional().describe(
          'The type of specialized agent to use for this task',
        ),
        name: z.string().optional().describe(
          'Teammate name. When set with `team_name`, spawns a persistent teammate ' +
          'process in the named team instead of running a one-shot sub-agent.',
        ),
        team_name: z.string().optional().describe(
          'Team the teammate joins. Create teams via TeamCreate first.',
        ),
        model: z.string().optional().describe(
          'Optional model override for the spawned teammate.',
        ),
      }) as ZodType<AgentToolInput>
    },

    isReadOnly: () => false,
    isConcurrencySafe: () => false,

    async prompt() {
      const lines = [
        'Launch a sub-agent to handle a complex, multi-step task. ' +
        'The sub-agent runs in its own context with its own message history and returns a summary.',
        '',
        'Use it when:',
        '- The task requires exploring many files (the sub-agent\'s context won\'t pollute yours)',
        '- The task is independent enough to delegate (clear input, clear output)',
        '- You need a "fresh pair of eyes" on a sub-problem',
        '',
        'Don\'t use it for simple, quick operations — just do those yourself.',
        '',
        'When `subagent_type` is provided, the sub-agent uses the matching agent definition\'s ' +
        'system prompt and tool restrictions. If no match is found, the default general-purpose agent is used.',
      ]

      const agents = deps.agentRegistry?.getAllAgents() ?? []
      if (agents.length > 0) {
        lines.push(
          '',
          'Available agent types and the tools they have access to:',
        )
        for (const agent of agents) {
          const toolInfo = agent.tools
            ? agent.tools.join(', ')
            : agent.disallowedTools
              ? `All tools except ${agent.disallowedTools.join(', ')}`
              : 'All tools'
          lines.push(`- ${agent.agentType}: ${agent.whenToUse} (Tools: ${toolInfo})`)
        }
      }

      return lines.join('\n')
    },

    async description(input) {
      if (input.name && input.team_name) {
        return `Spawn teammate ${input.name}@${input.team_name}: ${input.description}`
      }
      const agentLabel = input.subagent_type
        ? `Agent(${input.subagent_type})`
        : 'Agent'
      return `${agentLabel}: ${input.description}`
    },

    userFacingName(input) {
      if (input.name && input.team_name) {
        return `Agent(spawn ${input.name}@${input.team_name})`
      }
      if (input.subagent_type) return `Agent(${input.subagent_type}: ${input.description ?? ''})`
      return input.description ? `Agent(${input.description})` : 'Agent'
    },

    async call(input, context) {
      const { prompt, description, subagent_type, name, team_name, model } = input
      const startTime = Date.now()

      // Teammate spawn: `name` + `team_name` route to a separate process
      // that runs its own agent loop and communicates via the team's
      // mailbox. Returns immediately; the caller coordinates via
      // SendMessage / inbox polling.
      if (name && team_name) {
        try {
          const permissionMode = deps.getPermissionMode?.() ?? 'default'
          const result = await spawnTeammate({
            teamName: team_name,
            name,
            agentType: subagent_type,
            model,
            initialPrompt: prompt,
            permissionMode,
          })
          const totalDurationMs = Date.now() - startTime
          logForDebugging(
            `teammate_spawn: id="${result.agentId}" pid=${result.pid ?? '?'}` +
              (result.windowId ? ` window=${result.windowId}` : ''),
            { level: 'info' },
          )
          return {
            data: {
              status: 'spawned',
              content:
                `Teammate "${result.agentId}" spawned. ` +
                `Initial prompt delivered to inbox. ` +
                `Use SendMessage to talk to them; watch your inbox for replies.`,
              totalDurationMs,
              agentId: result.agentId,
            },
          }
        } catch (error: unknown) {
          const totalDurationMs = Date.now() - startTime
          const errorMsg = getErrorMessage(error)
          logForDebugging(
            `teammate_spawn_error: team="${team_name}" name="${name}" error="${errorMsg}"`,
            { level: 'error' },
          )
          return {
            data: {
              status: 'error',
              content: `Teammate spawn failed: ${errorMsg}`,
              totalDurationMs,
            },
          }
        }
      }

      if (name || team_name) {
        return {
          data: {
            status: 'error',
            content:
              'Teammate spawning requires both `name` and `team_name`. ' +
              'Omit both for a one-shot sub-agent.',
            totalDurationMs: Date.now() - startTime,
          },
        }
      }

      const childAbort = new AbortController()
      const onParentAbort = () => childAbort.abort()
      context.abortController.signal.addEventListener('abort', onParentAbort, { once: true })

      try {
        // Start with the base child-safe tools
        let childTools = filterToolsForChild(deps.tools)
        let systemPrompt = CHILD_SYSTEM_PROMPT

        // Resolve agent definition if subagent_type was specified
        const agentDef = subagent_type
          ? deps.agentRegistry?.findAgent(subagent_type)
          : undefined

        if (agentDef) {
          systemPrompt = agentDef.getSystemPrompt()
          childTools = resolveAgentTools(agentDef, childTools)
          logForDebugging(
            `agent_spawn: type="${subagent_type}" description="${description}" ` +
            `tools=${childTools.length} source=${agentDef.source}`,
            { level: 'info' },
          )
        } else {
          logForDebugging(
            `agent_spawn: type="general-purpose" description="${description}"`,
            { level: 'info' },
          )
        }

        const childDeps = deps.createChildQueryDeps({
          tools: childTools,
          abortController: childAbort,
        })

        const initialMessage = createUserMessage({ content: prompt })

        const MAX_ACTIVITY_LOG = 50
        const activityLog: AgentActivityEntry[] = []
        const emitProgress = (activity: AgentProgress['activity'], label: string) => {
          if (activityLog.length >= MAX_ACTIVITY_LOG) activityLog.shift()
          activityLog.push({ type: activity, label, timestamp: Date.now() })
          const progress: AgentProgress = {
            activity,
            label,
            elapsedMs: Date.now() - startTime,
            log: activityLog,
          }
          context.onProgress?.(progress)
        }

        emitProgress('thinking', 'Starting...')

        let lastAssistantText = ''
        let lastError = ''
        for await (const event of query({
          messages: [initialMessage],
          systemPrompt: [systemPrompt],
          abortSignal: childAbort.signal,
          deps: childDeps,
        })) {
          if (event.type === 'assistant') {
            lastAssistantText = extractTextFromContent(event.message.content)
            const content = event.message.content
            if (Array.isArray(content)) {
              for (const block of content) {
                if (typeof block === 'object' && block !== null && 'type' in block) {
                  if (block.type === 'tool_use') {
                    const name = 'name' in block ? String(block.name) : 'unknown'
                    emitProgress('tool_use', name)
                  } else if (block.type === 'thinking') {
                    emitProgress('thinking', 'Thinking...')
                  } else if (block.type === 'text' && 'text' in block) {
                    const text = String(block.text)
                    if (text.trim().length > 0) {
                      const preview = text.trim().slice(0, 80)
                      emitProgress('text', preview + (text.length > 80 ? '...' : ''))
                    }
                  }
                }
              }
            }
          } else if (event.type === 'user' && 'toolName' in event && event.toolName) {
            emitProgress('tool_result', `${event.toolName} done`)
          } else if (event.type === 'system' && 'level' in event && event.level === 'error') {
            lastError = event.content
            emitProgress('error', lastError)
          }
        }

        const totalDurationMs = Date.now() - startTime

        if (lastError) {
          logForDebugging(
            `agent_error: description="${description}" error="${lastError}"`,
            { level: 'error' },
          )
          return {
            data: { status: 'error', content: `Sub-agent error: ${lastError}`, totalDurationMs },
          }
        }

        const content = lastAssistantText.length > 0 ? lastAssistantText : '(no response)'

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

    renderToolUseProgressMessage,

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
