import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SpanStatusCode } from '@opentelemetry/api'
import type { ContentBlock, StopReason } from '@anthropic-ai/sdk/resources/messages/messages'
import type { AssistantMessage } from '../types/message.js'
import type { QueryEvent } from '../types/streamEvents.js'
import type {
  AgentEvent,
  AgentQueryParams,
  CallModelParams,
  QueryDeps,
  Terminal,
  ToolUseInfo,
} from '../services/agent/types.js'
import type { ToolBatchEvent } from '../services/tools/execution/types.js'
import { createUserMessage } from '../services/messages/factory.js'
import { query } from '../services/agent/index.js'
import {
  __getCollectedSpansForTests,
  __resetTracerForTests,
  flushTracer,
} from '../services/observability/tracing.js'
import { ATTR, OP_CHAT, OP_EXECUTE_TOOL } from '../services/observability/attributes.js'
import { snapshotEnv } from '../testing/env-snapshot.js'

let restoreEnv: () => void

beforeEach(() => {
  restoreEnv = snapshotEnv(['NODE_ENV', 'OTEL_TRACES_EXPORTER', 'PA_DEBUG'])
  process.env['NODE_ENV'] = 'test'
  delete process.env['OTEL_TRACES_EXPORTER']
  process.env['PA_DEBUG'] = '0'
  __resetTracerForTests()
})

afterEach(() => {
  __resetTracerForTests()
  restoreEnv()
})

function createAssistantMsg(
  content: ContentBlock[],
  stopReason: StopReason = 'end_turn',
): AssistantMessage {
  return {
    type: 'assistant',
    uuid: `asst-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    requestId: 'req-test-123',
    message: {
      id: `msg-${crypto.randomUUID()}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-test',
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      stop_details: null,
      container: null,
      usage: {
        input_tokens: 100,
        output_tokens: 25,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 50,
        cache_creation: null,
        inference_geo: null,
        server_tool_use: null,
        service_tier: null,
      },
    },
  }
}

function textBlock(text: string): ContentBlock {
  return { type: 'text', text, citations: null } as ContentBlock
}

function toolUseBlock(id: string, name: string, input: unknown): ContentBlock {
  return { type: 'tool_use', id, name, input, caller: { type: 'direct' } } as ContentBlock
}

function makeBatchExecutor(
  executeFn: (tu: ToolUseInfo) => Promise<{ content: string; isError: boolean }>,
): QueryDeps['executeToolBatch'] {
  return async function* ({ toolUseBlocks, assistantMessageUUID }) {
    for (const block of toolUseBlocks) {
      const result = await executeFn(block)
      yield {
        type: 'tool_result',
        message: createUserMessage({
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: block.id,
              content: result.content,
              is_error: result.isError || undefined,
            },
          ],
          isMeta: true,
          toolUseResult: result,
          sourceToolAssistantUUID: assistantMessageUUID,
          uuid: `uuid-${block.id}`,
        }),
      } as ToolBatchEvent
    }
  }
}

function sequentialCallModel(responses: AssistantMessage[]): QueryDeps['callModel'] {
  let index = 0
  return async function* (_params: CallModelParams): AsyncGenerator<QueryEvent> {
    const response = responses[index]
    if (!response) throw new Error(`No response for call index ${index}`)
    index++
    yield response
  }
}

async function collectAll(
  gen: AsyncGenerator<AgentEvent, Terminal>,
): Promise<{ events: AgentEvent[]; terminal: Terminal }> {
  const events: AgentEvent[] = []
  let result = await gen.next()
  while (!result.done) {
    events.push(result.value)
    result = await gen.next()
  }
  return { events, terminal: result.value }
}

describe('observability/agent loop integration', () => {
  test('emits interaction + llm_request + tool spans for a tool-using turn', async () => {
    const userMsg = createUserMessage({ content: 'list files', uuid: 'u-1' })
    const turn1 = createAssistantMsg(
      [toolUseBlock('tu_1', 'BashTool', { command: 'ls' })],
      'tool_use',
    )
    const turn2 = createAssistantMsg([textBlock('done')], 'end_turn')

    const params: AgentQueryParams = {
      messages: [userMsg],
      systemPrompt: ['sys'],
      deps: {
        callModel: sequentialCallModel([turn1, turn2]),
        executeToolBatch: makeBatchExecutor(async () => ({
          content: 'file1\nfile2',
          isError: false,
        })),
        uuid: () => `uuid-${Math.random()}`,
      },
    }

    const { terminal } = await collectAll(query(params))
    expect(terminal.reason).toBe('completed')

    await flushTracer()
    const spans = __getCollectedSpansForTests()

    const interactions = spans.filter(s => s.name === 'interaction')
    // LLM spans now follow the GenAI convention: "chat <model>"
    const llmRequests = spans.filter(s => s.name.startsWith(`${OP_CHAT} `))
    // Tool spans now follow the convention: "execute_tool <tool_name>"
    const tools = spans.filter(s => s.name.startsWith(`${OP_EXECUTE_TOOL} `))

    expect(interactions.length).toBe(1)
    expect(llmRequests.length).toBe(2)
    expect(tools.length).toBe(1)

    // Parent-child wiring: every LLM and tool span must nest under the
    // interaction root so Langfuse can render a proper waterfall instead
    // of a flat list of disconnected spans.
    const interactionSpanId = interactions[0]!.spanContext().spanId
    const interactionTraceId = interactions[0]!.spanContext().traceId
    for (const llm of llmRequests) {
      expect(llm.parentSpanContext?.spanId).toBe(interactionSpanId)
      expect(llm.spanContext().traceId).toBe(interactionTraceId)
    }
    for (const tool of tools) {
      expect(tool.parentSpanContext?.spanId).toBe(interactionSpanId)
      expect(tool.spanContext().traceId).toBe(interactionTraceId)
    }

    // LLM spans carry usage from the assistant message
    expect(llmRequests[0]!.attributes[ATTR.GEN_AI_USAGE_INPUT_TOKENS]).toBe(100)
    expect(llmRequests[0]!.attributes[ATTR.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(25)
    expect(llmRequests[0]!.attributes[ATTR.GEN_AI_USAGE_CACHE_READ]).toBe(50)
    expect(llmRequests[0]!.attributes[ATTR.GEN_AI_RESPONSE_FINISH_REASONS]).toEqual(['tool_use'])
    expect(llmRequests[0]!.attributes[ATTR.GEN_AI_RESPONSE_ID]).toBe('req-test-123')
    // Input messages + output blocks land in the Langfuse Input/Output panels.
    expect(llmRequests[0]!.attributes[ATTR.LANGFUSE_OBSERVATION_INPUT]).toBeDefined()
    expect(llmRequests[0]!.attributes[ATTR.LANGFUSE_OBSERVATION_OUTPUT]).toBeDefined()

    // Tool span carries name + success
    expect(tools[0]!.attributes[ATTR.GEN_AI_TOOL_NAME]).toBe('BashTool')
    expect(tools[0]!.attributes[ATTR.PA_TOOL_SUCCESS]).toBe(true)
    expect(Number(tools[0]!.attributes[ATTR.PA_TOOL_OUTPUT_SIZE])).toBeGreaterThan(0)
    // Tool input + output feed the Langfuse panels.
    expect(tools[0]!.attributes[ATTR.LANGFUSE_OBSERVATION_INPUT]).toBeDefined()
    expect(tools[0]!.attributes[ATTR.LANGFUSE_OBSERVATION_OUTPUT]).toBeDefined()
  })

  test('marks tool span as failed when tool_result has is_error', async () => {
    const userMsg = createUserMessage({ content: 'do bad thing', uuid: 'u-2' })
    const turn1 = createAssistantMsg(
      [toolUseBlock('tu_err', 'BashTool', { command: 'false' })],
      'tool_use',
    )
    const turn2 = createAssistantMsg([textBlock('ok')], 'end_turn')

    const { terminal } = await collectAll(
      query({
        messages: [userMsg],
        systemPrompt: ['sys'],
        deps: {
          callModel: sequentialCallModel([turn1, turn2]),
          executeToolBatch: makeBatchExecutor(async () => ({
            content: 'boom',
            isError: true,
          })),
          uuid: () => 'u',
        },
      }),
    )
    expect(terminal.reason).toBe('completed')
    await flushTracer()

    const tool = __getCollectedSpansForTests().find(s =>
      s.name.startsWith(`${OP_EXECUTE_TOOL} `),
    )!
    expect(tool).toBeDefined()
    expect(tool.attributes[ATTR.PA_TOOL_SUCCESS]).toBe(false)
    // Span status must propagate the failure — don't swallow errors.
    expect(tool.status.code).toBe(SpanStatusCode.ERROR)
  })

  test('interaction span closes even when model throws', async () => {
    const userMsg = createUserMessage({ content: 'go', uuid: 'u-3' })
    const failingCallModel: QueryDeps['callModel'] = async function* () {
      throw new Error('boom')
      yield {} as never
    }

    const { terminal } = await collectAll(
      query({
        messages: [userMsg],
        systemPrompt: ['sys'],
        deps: {
          callModel: failingCallModel,
          executeToolBatch: makeBatchExecutor(async () => ({ content: '', isError: false })),
          uuid: () => 'u',
        },
      }),
    )
    expect(terminal.reason).toBe('model_error')
    await flushTracer()

    const interactions = __getCollectedSpansForTests().filter(s => s.name === 'interaction')
    expect(interactions.length).toBe(1)
    // Span must have ended (endTime is non-zero)
    expect(interactions[0]!.endTime[0]).toBeGreaterThan(0)
  })
})
