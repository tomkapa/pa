import type Anthropic from '@anthropic-ai/sdk'
import type {
  TextBlockParam,
  Tool as AnthropicTool,
} from '@anthropic-ai/sdk/resources/messages/messages'
import type { AssistantMessage } from '../../types/message.js'
import type {
  AutoCompactFn,
  AutoCompactOutcome,
  AutoCompactParams,
  CallModelParams,
  QueryDeps,
  ToolUseInfo,
} from './types.js'
import type { ToolBatchEvent, CanUseToolFn } from '../tools/execution/types.js'
import type { Tool, ToolUseContext } from '../tools/types.js'
import type { QueryEvent } from '../../types/streamEvents.js'
import type { ToolPermissionContext } from '../permissions/types.js'
import { queryWithStreaming } from '../api/query.js'
import { runTools } from '../tools/execution/run-tools.js'
import { toApiTools } from '../tools/to-api-tools.js'
import { hasPermissionsToUseTool } from '../permissions/pipeline.js'
import { createCanUseToolWithConfirm, type ToolUseConfirm } from '../permissions/confirm.js'
import { DYNAMIC_BOUNDARY } from '../system-prompt/types.js'
import {
  compactConversation,
  createAnthropicSummarizer,
  evaluateAutoCompact,
} from './auto-compact.js'
import type { SummarizeFn } from './auto-compact.js'
import { buildThinkingConfig } from './thinking.js'

/**
 * Convert the agent's system prompt array (sections + boundary marker)
 * into the SDK's `system` field. The boundary marker is dropped here —
 * it exists for future API-layer cache-control splitting (CODE-70 /
 * CODE-52) and is not meaningful to the model itself. We emit one
 * `text` block per surviving section so the API call's structure stays
 * close to what the future caching layer will need.
 */
export function systemPromptToBlocks(prompt: string[]): TextBlockParam[] {
  return prompt
    .filter(s => s !== DYNAMIC_BOUNDARY && s.length > 0)
    .map(text => ({ type: 'text', text }))
}

export interface CreateQueryDepsOptions {
  client: Anthropic
  model: string
  maxTokens: number
  tools: Tool<unknown, unknown>[]
  abortController: AbortController
  permissionContext: ToolPermissionContext
  pushConfirm?: (confirm: ToolUseConfirm) => void
  /** Called by tools that need to update permission state (e.g. plan mode). */
  getPermissionContext?: () => ToolPermissionContext
  setPermissionContext?: (
    updater: (ctx: ToolPermissionContext) => ToolPermissionContext,
  ) => void
}

function createCanUseTool(getCtx: () => ToolPermissionContext): CanUseToolFn {
  return async (tool, input, toolUseCtx) =>
    hasPermissionsToUseTool(tool, input, getCtx(), toolUseCtx)
}

export function createQueryDeps(options: CreateQueryDepsOptions): QueryDeps {
  const {
    client, model, maxTokens, tools, abortController, permissionContext,
    pushConfirm, getPermissionContext, setPermissionContext,
  } = options

  // Read the latest permission context on every tool call so mid-turn
  // mode switches (Shift+Tab) take effect between iterations — same
  // pattern as drainQueuedInput for buffered user messages.
  const resolveCtx = getPermissionContext ?? (() => permissionContext)

  // Recompute API tools each turn so late-arriving MCP tools are included.
  // `toApiTools` is cheap (prompt() calls are fast string returns) and the
  // tools array may grow after MCP servers connect.
  let apiToolsPromise: Promise<AnthropicTool[]> | undefined
  let lastToolsLength = tools.length

  const canUseTool = pushConfirm
    ? createCanUseToolWithConfirm(resolveCtx, pushConfirm)
    : createCanUseTool(resolveCtx)

  const summarize = createAnthropicSummarizer(client, model, maxTokens)
  const autoCompact = createAutoCompactImpl(model, summarize)

  return {
    callModel(params: CallModelParams): AsyncGenerator<QueryEvent> {
      // Invalidate the cached API tools when the tools array grows (MCP tools arrived).
      if (tools.length !== lastToolsLength) {
        apiToolsPromise = undefined
        lastToolsLength = tools.length
      }
      apiToolsPromise ??= toApiTools(tools)
      return callModelImpl(client, model, maxTokens, params, apiToolsPromise)
    },
    executeToolBatch(params) {
      return executeToolBatchImpl(
        params, tools, abortController, canUseTool,
        getPermissionContext, setPermissionContext,
      )
    },
    uuid: () => crypto.randomUUID(),
    autoCompact,
    getPermissionMode: getPermissionContext
      ? () => getPermissionContext().mode
      : undefined,
  }
}

/**
 * Wraps `compactConversation` in the `AutoCompactFn` shape the query loop
 * expects: decides whether to compact, then runs it. The token count from
 * the threshold check is threaded into the compaction call so the loop
 * doesn't walk the message array twice on compact turns.
 */
function createAutoCompactImpl(
  model: string,
  summarize: SummarizeFn,
): AutoCompactFn {
  return async (params: AutoCompactParams): Promise<AutoCompactOutcome> => {
    const decision = evaluateAutoCompact({ messages: params.messages, model })
    if (!decision.shouldCompact) {
      return { compactionResult: null, tracking: params.tracking }
    }

    const compactionResult = await compactConversation({
      messages: params.messages,
      summarize,
      trigger: 'auto',
      abortSignal: params.abortSignal,
      preCompactTokenCount: decision.tokenCount,
    })

    return {
      compactionResult,
      tracking: { compacted: true },
    }
  }
}

async function* callModelImpl(
  client: Anthropic,
  model: string,
  maxTokens: number,
  params: CallModelParams,
  apiToolsPromise: Promise<AnthropicTool[]>,
): AsyncGenerator<QueryEvent> {
  const apiTools = await apiToolsPromise

  // `buildThinkingConfig` enforces `budget_tokens < max_tokens` (API rejects
  // otherwise) and returns `undefined` for `'off'` so the spread is a no-op.
  const thinking = params.effort
    ? buildThinkingConfig(params.effort, maxTokens)
    : undefined

  yield* queryWithStreaming(client, {
    model,
    max_tokens: maxTokens,
    messages: params.messages,
    system: systemPromptToBlocks(params.systemPrompt),
    abortSignal: params.abortSignal,
    ...(apiTools.length > 0 ? { tools: apiTools } : {}),
    ...(thinking ? { thinking } : {}),
  })
}

async function* executeToolBatchImpl(
  params: {
    toolUseBlocks: ToolUseInfo[]
    assistantMessageUUID: string
    abortSignal?: AbortSignal
  },
  tools: Tool<unknown, unknown>[],
  abortController: AbortController,
  canUseTool: CanUseToolFn,
  getPermissionContext?: () => ToolPermissionContext,
  setPermissionContext?: (
    updater: (ctx: ToolPermissionContext) => ToolPermissionContext,
  ) => void,
): AsyncGenerator<ToolBatchEvent> {
  // runTools only reads assistantMessage.uuid — stub the rest
  const stubAssistant = { uuid: params.assistantMessageUUID } as AssistantMessage

  const context: ToolUseContext = {
    abortController,
    messages: [],
    options: { tools, debug: false, verbose: false },
    getPermissionContext,
    setPermissionContext,
  }

  for await (const event of runTools(params.toolUseBlocks, stubAssistant, canUseTool, context)) {
    if (event.type === 'tool_result') {
      yield { type: 'tool_result', message: event.message }
    } else if (event.type === 'progress') {
      yield event
    }
    // context_update events are internal to the execution engine
  }
}
