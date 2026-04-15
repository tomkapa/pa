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
import {
  getToolsForAPICall,
  buildDeferredToolsAnnouncement,
} from '../tools/deferred-tools.js'
import { isToolSearchOutput } from '../../tools/toolSearchTool.js'

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

  // Track tools the model has discovered via ToolSearch this session.
  // Once discovered, a deferred tool is included in the API `tools` array
  // on all subsequent calls. The set persists across compaction.
  const discoveredTools = new Set<string>()

  // Recompute API tools each turn so late-arriving MCP tools are included.
  // `toApiTools` is cheap (prompt() calls are fast string returns) and the
  // tools array may grow after MCP servers connect or ToolSearch discovers new tools.
  let apiToolsPromise: Promise<AnthropicTool[]> | undefined
  let cachedDeferredAnnouncement: string | null | undefined
  let lastToolsLength = tools.length
  let lastDiscoveredSize = 0

  const canUseTool = pushConfirm
    ? createCanUseToolWithConfirm(resolveCtx, pushConfirm)
    : createCanUseTool(resolveCtx)

  const summarize = createAnthropicSummarizer(client, model, maxTokens)
  const autoCompact = createAutoCompactImpl(model, summarize)

  /**
   * Refresh the per-turn caches when the tool set has changed since the last
   * call, then return the current deferred-tools announcement. Extracted so
   * both `callModel` and `getDeferredAnnouncement` share identical staleness
   * logic without duplicating it.
   */
  function refreshAndGetAnnouncement(): string | null {
    if (tools.length !== lastToolsLength || discoveredTools.size !== lastDiscoveredSize) {
      apiToolsPromise = undefined
      cachedDeferredAnnouncement = undefined
      lastToolsLength = tools.length
      lastDiscoveredSize = discoveredTools.size
    }
    apiToolsPromise ??= toApiTools(getToolsForAPICall(tools, discoveredTools))
    cachedDeferredAnnouncement ??= buildDeferredToolsAnnouncement(tools, discoveredTools)
    return cachedDeferredAnnouncement
  }

  return {
    callModel(params: CallModelParams): AsyncGenerator<QueryEvent> {
      const announcement = refreshAndGetAnnouncement()
      return callModelImpl(
        client, model, maxTokens, params, apiToolsPromise!,
        announcement,
      )
    },
    getDeferredAnnouncement(): string | null {
      return refreshAndGetAnnouncement()
    },
    executeToolBatch(params) {
      return executeToolBatchImpl(
        params, tools, abortController, canUseTool,
        discoveredTools,
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
  deferredAnnouncement: string | null,
): AsyncGenerator<QueryEvent> {
  const apiTools = await apiToolsPromise

  // `buildThinkingConfig` enforces `budget_tokens < max_tokens` (API rejects
  // otherwise) and returns `undefined` for `'off'` so the spread is a no-op.
  const thinking = params.effort
    ? buildThinkingConfig(params.effort, maxTokens)
    : undefined

  // Announce deferred tools so the model knows they exist (by name only).
  // The announcement is appended after the main system prompt so it does
  // not bust the cache for the static+dynamic sections.
  const systemBlocks = systemPromptToBlocks(params.systemPrompt)
  if (deferredAnnouncement) {
    systemBlocks.push({ type: 'text', text: deferredAnnouncement })
  }

  yield* queryWithStreaming(client, {
    model,
    max_tokens: maxTokens,
    messages: params.messages,
    system: systemBlocks,
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
  discoveredTools: Set<string>,
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
      // Detect ToolSearch results and register discovered tools so they are
      // included in the API `tools` array on the next call.
      if (
        event.message.toolName === 'ToolSearch' &&
        isToolSearchOutput(event.message.toolUseResult)
      ) {
        for (const match of event.message.toolUseResult.resolvedMatches) {
          discoveredTools.add(match.tool.name)
        }
      }
      yield { type: 'tool_result', message: event.message }
    } else if (event.type === 'progress') {
      yield event
    }
    // context_update events are internal to the execution engine
  }
}
