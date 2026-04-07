import type Anthropic from '@anthropic-ai/sdk'
import type {
  TextBlockParam,
  Tool as AnthropicTool,
} from '@anthropic-ai/sdk/resources/messages/messages'
import type { AssistantMessage } from '../../types/message.js'
import type { QueryDeps, CallModelParams, ToolUseInfo } from './types.js'
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
}

function createCanUseTool(permissionCtx: ToolPermissionContext): CanUseToolFn {
  return async (tool, input, toolUseCtx) =>
    hasPermissionsToUseTool(tool, input, permissionCtx, toolUseCtx)
}

export function createQueryDeps(options: CreateQueryDepsOptions): QueryDeps {
  const { client, model, maxTokens, tools, abortController, permissionContext, pushConfirm } = options

  // Convert tool definitions once — reused across all turns in this query
  let apiToolsPromise: Promise<AnthropicTool[]> | undefined

  const canUseTool = pushConfirm
    ? createCanUseToolWithConfirm(permissionContext, pushConfirm)
    : createCanUseTool(permissionContext)

  return {
    callModel(params: CallModelParams): AsyncGenerator<QueryEvent> {
      apiToolsPromise ??= toApiTools(tools)
      return callModelImpl(client, model, maxTokens, params, apiToolsPromise)
    },
    executeToolBatch(params) {
      return executeToolBatchImpl(params, tools, abortController, canUseTool)
    },
    uuid: () => crypto.randomUUID(),
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

  yield* queryWithStreaming(client, {
    model,
    max_tokens: maxTokens,
    messages: params.messages,
    system: systemPromptToBlocks(params.systemPrompt),
    abortSignal: params.abortSignal,
    ...(apiTools.length > 0 ? { tools: apiTools } : {}),
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
): AsyncGenerator<ToolBatchEvent> {
  // runTools only reads assistantMessage.uuid — stub the rest
  const stubAssistant = { uuid: params.assistantMessageUUID } as AssistantMessage

  const context: ToolUseContext = {
    abortController,
    messages: [],
    options: { tools, debug: false, verbose: false },
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
