import type Anthropic from '@anthropic-ai/sdk'
import type { AssistantMessage } from '../../types/message.js'
import type { QueryDeps, CallModelParams, ToolUseInfo } from './types.js'
import type { ToolBatchEvent, CanUseToolFn } from '../tools/execution/types.js'
import type { Tool, ToolUseContext } from '../tools/types.js'
import type { QueryEvent } from '../../types/streamEvents.js'
import { queryWithStreaming } from '../api/query.js'
import { runTools } from '../tools/execution/run-tools.js'

export interface CreateQueryDepsOptions {
  client: Anthropic
  model: string
  maxTokens: number
  tools: Tool<unknown, unknown>[]
  abortController: AbortController
}

// S-011 replaces this with real permission checking
const allowAllCanUseTool: CanUseToolFn = async (_tool, input) => ({
  behavior: 'allow',
  updatedInput: input,
})

export function createQueryDeps(options: CreateQueryDepsOptions): QueryDeps {
  const { client, model, maxTokens, tools, abortController } = options

  return {
    callModel(params: CallModelParams): AsyncGenerator<QueryEvent> {
      return callModelImpl(client, model, maxTokens, params)
    },
    executeToolBatch(params) {
      return executeToolBatchImpl(params, tools, abortController, allowAllCanUseTool)
    },
    uuid: () => crypto.randomUUID(),
  }
}

async function* callModelImpl(
  client: Anthropic,
  model: string,
  maxTokens: number,
  params: CallModelParams,
): AsyncGenerator<QueryEvent> {
  yield* queryWithStreaming(client, {
    model,
    max_tokens: maxTokens,
    messages: params.messages,
    system: params.systemPrompt,
    abortSignal: params.abortSignal,
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
