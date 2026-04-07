import { describe, test, expect, mock } from 'bun:test'
import type { ContentBlock, StopReason } from '@anthropic-ai/sdk/resources/messages/messages'
import type { AssistantMessage, UserMessage } from '../types/message.js'
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
import { query, queryLoop } from '../services/agent/index.js'

// ─── Helpers ────────────────────────────────────────────────────────────

function createAssistantMsg(
  content: ContentBlock[],
  stopReason: StopReason = 'end_turn',
): AssistantMessage {
  return {
    type: 'assistant',
    uuid: `asst-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    requestId: 'req-test',
    message: {
      id: `msg-${crypto.randomUUID()}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      stop_details: null,
      container: null,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
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

/**
 * Build a simple batch executor from per-tool logic.
 * Mirrors the old executeTool pattern adapted for the batch interface.
 */
function makeBatchExecutor(
  executeFn: (tu: ToolUseInfo) => Promise<{ content: string; isError: boolean }>,
  uuidFn: () => string,
): QueryDeps['executeToolBatch'] {
  return async function* ({ toolUseBlocks, assistantMessageUUID, abortSignal }) {
    for (const block of toolUseBlocks) {
      if (abortSignal?.aborted) {
        yield makeToolResultEvent(block.id, 'Aborted', true, assistantMessageUUID, uuidFn())
        continue
      }

      let result: { content: string; isError: boolean }
      try {
        result = await executeFn(block)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        result = { content: `Tool execution error: ${msg}`, isError: true }
      }

      yield makeToolResultEvent(
        block.id,
        result.content,
        result.isError,
        assistantMessageUUID,
        uuidFn(),
      )
    }
  }
}

function makeToolResultEvent(
  toolUseId: string,
  content: string,
  isError: boolean,
  assistantMessageUUID: string,
  uuid: string,
): ToolBatchEvent {
  return {
    type: 'tool_result',
    message: createUserMessage({
      content: [{
        type: 'tool_result' as const,
        tool_use_id: toolUseId,
        content,
        is_error: isError || undefined,
      }],
      isMeta: true,
      toolUseResult: { toolUseId, content, isError },
      sourceToolAssistantUUID: assistantMessageUUID,
      uuid,
    }),
  }
}

function createDeps(overrides: Partial<QueryDeps> = {}): QueryDeps {
  let uuidCounter = 0
  const uuidFn = overrides.uuid ?? (() => `uuid-${++uuidCounter}`)
  return {
    callModel: overrides.callModel ?? (async function* () { /* no-op */ }),
    executeToolBatch: overrides.executeToolBatch ?? makeBatchExecutor(
      async () => ({ content: '', isError: false }),
      uuidFn,
    ),
    uuid: uuidFn,
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

function baseParams(overrides: Partial<AgentQueryParams> = {}): AgentQueryParams {
  return {
    messages: [],
    systemPrompt: ['You are a test assistant.'],
    deps: createDeps(),
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('agent loop', () => {
  // ── Basic completion ──────────────────────────────────────────────

  describe('completion', () => {
    test('completes when model responds with no tool calls', async () => {
      const response = createAssistantMsg([textBlock('Hello!')])
      const deps = createDeps({
        callModel: sequentialCallModel([response]),
      })

      const { events, terminal } = await collectAll(query(baseParams({ deps })))

      expect(terminal.reason).toBe('completed')
      expect(terminal.turnCount).toBe(1)
      expect(events.some(e => e.type === 'assistant')).toBe(true)
    })

    test('returns turnCount reflecting completed model calls', async () => {
      const executeFn = mock(async (tu: ToolUseInfo) => ({
        content: 'ok',
        isError: false,
      }))
      let uuidCounter = 0
      const uuidFn = () => `uuid-${++uuidCounter}`

      const deps = createDeps({
        callModel: sequentialCallModel([
          createAssistantMsg([toolUseBlock('t1', 'tool', {})], 'tool_use'),
          createAssistantMsg([textBlock('Done')]),
        ]),
        executeToolBatch: makeBatchExecutor(executeFn, uuidFn),
        uuid: uuidFn,
      })

      const { terminal } = await collectAll(query(baseParams({ deps })))

      expect(terminal.reason).toBe('completed')
      expect(terminal.turnCount).toBe(2)
    })
  })

  // ── Tool execution ────────────────────────────────────────────────

  describe('tool execution', () => {
    test('executes a single tool and loops until model completes', async () => {
      const executeFn = mock(async (tu: ToolUseInfo) => ({
        content: 'file contents',
        isError: false,
      }))
      let uuidCounter = 0
      const uuidFn = () => `uuid-${++uuidCounter}`

      const deps = createDeps({
        callModel: sequentialCallModel([
          createAssistantMsg([toolUseBlock('toolu_1', 'read_file', { path: 'test.ts' })], 'tool_use'),
          createAssistantMsg([textBlock('Done!')]),
        ]),
        executeToolBatch: makeBatchExecutor(executeFn, uuidFn),
        uuid: uuidFn,
      })

      const { events, terminal } = await collectAll(query(baseParams({ deps })))

      expect(terminal.reason).toBe('completed')
      expect(terminal.turnCount).toBe(2)
      expect(executeFn).toHaveBeenCalledTimes(1)

      const types = events.map(e => e.type)
      expect(types).toContain('assistant')
      expect(types).toContain('user')
    })

    test('executes multiple tools from a single model response', async () => {
      const executeFn = mock(async (tu: ToolUseInfo) => ({
        content: `result-${tu.id}`,
        isError: false,
      }))
      let uuidCounter = 0
      const uuidFn = () => `uuid-${++uuidCounter}`

      const deps = createDeps({
        callModel: sequentialCallModel([
          createAssistantMsg([
            toolUseBlock('toolu_1', 'read_file', { path: 'a.ts' }),
            toolUseBlock('toolu_2', 'read_file', { path: 'b.ts' }),
          ], 'tool_use'),
          createAssistantMsg([textBlock('Done!')]),
        ]),
        executeToolBatch: makeBatchExecutor(executeFn, uuidFn),
        uuid: uuidFn,
      })

      const { terminal } = await collectAll(query(baseParams({ deps })))

      expect(terminal.reason).toBe('completed')
      expect(executeFn).toHaveBeenCalledTimes(2)
    })

    test('handles multi-turn tool loop', async () => {
      let callCount = 0
      const callModel: QueryDeps['callModel'] = async function* () {
        callCount++
        if (callCount < 3) {
          yield createAssistantMsg(
            [toolUseBlock(`toolu_${callCount}`, 'tool', {})],
            'tool_use',
          )
        } else {
          yield createAssistantMsg([textBlock('All done')])
        }
      }

      let uuidCounter = 0
      const uuidFn = () => `uuid-${++uuidCounter}`
      const deps = createDeps({
        callModel,
        executeToolBatch: makeBatchExecutor(
          async () => ({ content: 'ok', isError: false }),
          uuidFn,
        ),
        uuid: uuidFn,
      })

      const { terminal } = await collectAll(query(baseParams({ deps })))

      expect(terminal.reason).toBe('completed')
      expect(terminal.turnCount).toBe(3)
      expect(callCount).toBe(3)
    })

    test('catches tool execution errors and sends error result to model', async () => {
      let uuidCounter = 0
      const uuidFn = () => `uuid-${++uuidCounter}`

      const deps = createDeps({
        callModel: sequentialCallModel([
          createAssistantMsg([toolUseBlock('toolu_1', 'dangerous', {})], 'tool_use'),
          createAssistantMsg([textBlock('I see the error.')]),
        ]),
        executeToolBatch: makeBatchExecutor(
          async () => { throw new Error('Permission denied') },
          uuidFn,
        ),
        uuid: uuidFn,
      })

      const { events, terminal } = await collectAll(query(baseParams({ deps })))

      expect(terminal.reason).toBe('completed')

      const userEvents = events.filter(e => e.type === 'user')
      expect(userEvents.length).toBe(1)
      const userMsg = userEvents[0]!
      if (userMsg.type === 'user') {
        expect(userMsg.toolUseResult).toBeDefined()
        const result = userMsg.toolUseResult as { isError: boolean; content: string }
        expect(result.isError).toBe(true)
        expect(result.content).toContain('Permission denied')
      }
    })
  })

  // ── Max turns ─────────────────────────────────────────────────────

  describe('max turns', () => {
    test('stops at max turns limit', async () => {
      let callCount = 0
      const callModel: QueryDeps['callModel'] = async function* () {
        callCount++
        yield createAssistantMsg(
          [toolUseBlock(`toolu_${callCount}`, 'tool', {})],
          'tool_use',
        )
      }

      let uuidCounter = 0
      const uuidFn = () => `uuid-${++uuidCounter}`
      const deps = createDeps({
        callModel,
        executeToolBatch: makeBatchExecutor(
          async () => ({ content: 'result', isError: false }),
          uuidFn,
        ),
        uuid: uuidFn,
      })

      const { events, terminal } = await collectAll(
        query(baseParams({ maxTurns: 3, deps })),
      )

      expect(terminal.reason).toBe('max_turns')
      expect(terminal.turnCount).toBe(3)
      expect(callCount).toBe(3)

      const systemEvents = events.filter(e => e.type === 'system')
      expect(systemEvents.length).toBe(1)
    })

    test('completes before max turns if model finishes early', async () => {
      let callCount = 0
      const callModel: QueryDeps['callModel'] = async function* () {
        callCount++
        if (callCount === 2) {
          yield createAssistantMsg([textBlock('Done')])
        } else {
          yield createAssistantMsg(
            [toolUseBlock(`toolu_${callCount}`, 'tool', {})],
            'tool_use',
          )
        }
      }

      let uuidCounter = 0
      const uuidFn = () => `uuid-${++uuidCounter}`
      const deps = createDeps({
        callModel,
        executeToolBatch: makeBatchExecutor(
          async () => ({ content: 'ok', isError: false }),
          uuidFn,
        ),
        uuid: uuidFn,
      })

      const { terminal } = await collectAll(
        query(baseParams({ maxTurns: 10, deps })),
      )

      expect(terminal.reason).toBe('completed')
      expect(terminal.turnCount).toBe(2)
    })
  })

  // ── Abort handling ────────────────────────────────────────────────

  describe('abort', () => {
    test('handles abort during model call', async () => {
      const controller = new AbortController()

      const callModel: QueryDeps['callModel'] = async function* () {
        controller.abort()
        throw new DOMException('The operation was aborted', 'AbortError')
      }

      const deps = createDeps({ callModel })

      const { terminal } = await collectAll(
        query(baseParams({ abortSignal: controller.signal, deps })),
      )

      expect(terminal.reason).toBe('aborted')
    })

    test('handles abort between tool executions', async () => {
      const controller = new AbortController()
      let executedCount = 0

      let uuidCounter = 0
      const uuidFn = () => `uuid-${++uuidCounter}`

      const deps = createDeps({
        callModel: sequentialCallModel([
          createAssistantMsg([
            toolUseBlock('toolu_1', 'tool_a', {}),
            toolUseBlock('toolu_2', 'tool_b', {}),
          ], 'tool_use'),
        ]),
        executeToolBatch: makeBatchExecutor(
          async (tu) => {
            executedCount++
            if (executedCount === 1) {
              controller.abort()
            }
            return { content: 'ok', isError: false }
          },
          uuidFn,
        ),
        uuid: uuidFn,
      })

      const { events, terminal } = await collectAll(
        query(baseParams({ abortSignal: controller.signal, deps })),
      )

      // The batch executor handles both tools (one executed, one aborted)
      // Then the loop sees abort and terminates
      const userEvents = events.filter(e => e.type === 'user')
      expect(userEvents.length).toBe(2)
      expect(terminal.reason).toBe('aborted')
    })

    test('returns aborted when signal is already aborted before loop starts', async () => {
      const controller = new AbortController()
      controller.abort()

      const deps = createDeps()

      const { terminal } = await collectAll(
        query(baseParams({ abortSignal: controller.signal, deps })),
      )

      expect(terminal.reason).toBe('aborted')
      expect(terminal.turnCount).toBe(0)
    })
  })

  // ── Error handling ────────────────────────────────────────────────

  describe('errors', () => {
    test('handles model errors', async () => {
      const callModel: QueryDeps['callModel'] = async function* () {
        throw new Error('API rate limit exceeded')
      }

      const deps = createDeps({ callModel })

      const { events, terminal } = await collectAll(query(baseParams({ deps })))

      expect(terminal.reason).toBe('model_error')
      expect(terminal.error?.message).toBe('API rate limit exceeded')

      const systemEvents = events.filter(e => e.type === 'system')
      expect(systemEvents.length).toBe(1)
    })

    test('handles empty model response (no assistant message)', async () => {
      const callModel: QueryDeps['callModel'] = async function* () {
        // yields nothing
      }

      const deps = createDeps({ callModel })

      const { terminal } = await collectAll(query(baseParams({ deps })))

      expect(terminal.reason).toBe('model_error')
      expect(terminal.error?.message).toContain('No assistant message')
    })
  })

  // ── Event ordering ────────────────────────────────────────────────

  describe('event ordering', () => {
    test('yields assistant, then tool results, then next assistant', async () => {
      let uuidCounter = 0
      const uuidFn = () => `uuid-${++uuidCounter}`

      const deps = createDeps({
        callModel: sequentialCallModel([
          createAssistantMsg([toolUseBlock('toolu_1', 'read_file', {})], 'tool_use'),
          createAssistantMsg([textBlock('Done!')]),
        ]),
        executeToolBatch: makeBatchExecutor(
          async () => ({ content: 'file contents', isError: false }),
          uuidFn,
        ),
        uuid: uuidFn,
      })

      const { events } = await collectAll(query(baseParams({ deps })))

      const types = events.map(e => e.type)
      const firstAssistant = types.indexOf('assistant')
      const userIndex = types.indexOf('user')
      const secondAssistant = types.indexOf('assistant', firstAssistant + 1)

      expect(firstAssistant).toBeGreaterThanOrEqual(0)
      expect(userIndex).toBeGreaterThan(firstAssistant)
      expect(secondAssistant).toBeGreaterThan(userIndex)
    })

    test('forwards stream events from callModel', async () => {
      const streamEvent = {
        type: 'stream_event' as const,
        event: {
          type: 'message_start' as const,
          message: {
            id: 'msg-1',
            type: 'message' as const,
            role: 'assistant' as const,
            model: 'claude-sonnet-4-20250514',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            stop_details: null,
            container: null,
            usage: {
              input_tokens: 10,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              cache_creation: null,
              inference_geo: null,
              server_tool_use: null,
              service_tier: null,
            },
          },
        },
      }

      const callModel: QueryDeps['callModel'] = async function* () {
        yield streamEvent
        yield createAssistantMsg([textBlock('Hi')])
      }

      const deps = createDeps({ callModel })
      const { events } = await collectAll(query(baseParams({ deps })))

      expect(events[0]?.type).toBe('stream_event')
      expect(events[1]?.type).toBe('assistant')
    })
  })

  // ── Dependency injection ──────────────────────────────────────────

  describe('deps', () => {
    test('uses deps.uuid for tool result messages (via batch executor)', async () => {
      let counter = 0
      const uuidFn = () => `deterministic-${++counter}`

      const deps = createDeps({
        callModel: sequentialCallModel([
          createAssistantMsg([toolUseBlock('toolu_1', 'read_file', {})], 'tool_use'),
          createAssistantMsg([textBlock('Done')]),
        ]),
        executeToolBatch: makeBatchExecutor(
          async () => ({ content: 'result', isError: false }),
          uuidFn,
        ),
        uuid: uuidFn,
      })

      const { events } = await collectAll(query(baseParams({ deps })))

      const userEvent = events.find(e => e.type === 'user')
      expect(userEvent).toBeDefined()
      if (userEvent?.type === 'user') {
        expect(userEvent.uuid).toBe('deterministic-1')
      }
    })

    test('passes system prompt to callModel', async () => {
      const captured: CallModelParams[] = []
      const callModel: QueryDeps['callModel'] = async function* (params) {
        captured.push(params)
        yield createAssistantMsg([textBlock('ok')])
      }

      const deps = createDeps({ callModel })
      await collectAll(query(baseParams({ systemPrompt: ['Be helpful.'], deps })))

      expect(captured).toHaveLength(1)
      expect(captured[0]!.systemPrompt).toEqual(['Be helpful.'])
    })

    test('passes abort signal to callModel', async () => {
      const controller = new AbortController()
      const captured: CallModelParams[] = []

      const callModel: QueryDeps['callModel'] = async function* (params) {
        captured.push(params)
        yield createAssistantMsg([textBlock('ok')])
      }

      const deps = createDeps({ callModel })
      await collectAll(query(baseParams({
        abortSignal: controller.signal,
        deps,
      })))

      expect(captured[0]!.abortSignal).toBe(controller.signal)
    })

    test('passes normalized messages to callModel', async () => {
      const captured: CallModelParams[] = []
      const callModel: QueryDeps['callModel'] = async function* (params) {
        captured.push(params)
        yield createAssistantMsg([textBlock('ok')])
      }

      const deps = createDeps({ callModel })
      await collectAll(query({
        messages: [{
          type: 'user',
          uuid: 'u1',
          timestamp: '2024-01-01T00:00:00Z',
          message: { role: 'user', content: 'Hello' },
        }],
        systemPrompt: ['test'],
        deps,
      }))

      expect(captured[0]!.messages).toHaveLength(1)
      expect(captured[0]!.messages[0]!.role).toBe('user')
    })
  })

  // ── queryLoop direct tests ────────────────────────────────────────

  describe('queryLoop', () => {
    test('returns Terminal with correct shape', async () => {
      const deps = createDeps({
        callModel: sequentialCallModel([
          createAssistantMsg([textBlock('Hello')]),
        ]),
      })

      const { terminal } = await collectAll(queryLoop(baseParams({ deps })))

      expect(terminal).toHaveProperty('reason')
      expect(terminal).toHaveProperty('turnCount')
      expect(typeof terminal.reason).toBe('string')
      expect(typeof terminal.turnCount).toBe('number')
    })

    test('query wrapper delegates to queryLoop and returns same terminal', async () => {
      const deps = createDeps({
        callModel: sequentialCallModel([
          createAssistantMsg([textBlock('Hello')]),
        ]),
      })

      const loopResult = await collectAll(queryLoop(baseParams({ deps })))

      // Re-create deps (sequentialCallModel has consumed the response)
      const deps2 = createDeps({
        callModel: sequentialCallModel([
          createAssistantMsg([textBlock('Hello')]),
        ]),
      })
      const queryResult = await collectAll(query(baseParams({ deps: deps2 })))

      expect(queryResult.terminal.reason).toBe(loopResult.terminal.reason)
      expect(queryResult.terminal.turnCount).toBe(loopResult.terminal.turnCount)
    })
  })
})
