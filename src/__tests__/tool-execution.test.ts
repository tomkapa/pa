import { describe, test, expect, mock } from 'bun:test'
import { z } from 'zod'
import { Stream } from '../services/tools/execution/stream.js'
import { all } from '../services/tools/execution/all.js'
import { partitionIntoBatches } from '../services/tools/execution/partition.js'
import {
  isEmptyContent,
  contentSize,
  maybeTruncateLargeResult,
} from '../services/tools/execution/result-size.js'
import { runToolUse } from '../services/tools/execution/run-tool-use.js'
import { runTools } from '../services/tools/execution/run-tools.js'
import { buildTool } from '../services/tools/build-tool.js'
import type {
  Tool,
  ToolDef,
  ToolUseContext,
  PermissionResult,
} from '../services/tools/types.js'
import type {
  ToolUseBlock,
  ToolExecutionEvent,
  RunToolsEvent,
} from '../services/tools/execution/types.js'
import type { AssistantMessage } from '../types/message.js'
import { makeContext as makeBaseContext } from '../testing/make-context.js'

// ─── Test Helpers ──────────────────────────────────────────────────────

function makeToolDef(
  overrides?: Partial<ToolDef<{ message: string }, string>>,
): ToolDef<{ message: string }, string> {
  return {
    name: 'Echo',
    maxResultSizeChars: 50_000,
    inputSchema: z.strictObject({ message: z.string() }),
    async call(input) {
      return { data: input.message }
    },
    async prompt() {
      return 'Echoes input back.'
    },
    async description(input) {
      return `Echo: ${input.message}`
    },
    mapToolResultToToolResultBlockParam(output, toolUseID) {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: output,
      }
    },
    ...overrides,
  }
}

function makeContext(
  tools: Tool<unknown, unknown>[],
  overrides?: { abortController?: AbortController },
) {
  return makeBaseContext({
    ...overrides,
    options: { tools, debug: false, verbose: false },
  })
}

function makeToolUseBlock(
  id: string,
  name: string,
  input: unknown,
): ToolUseBlock {
  return { type: 'tool_use', id, name, input }
}

function makeAssistantMessage(): AssistantMessage {
  return {
    type: 'assistant',
    uuid: 'asst-test-uuid',
    timestamp: new Date().toISOString(),
    requestId: 'req-test',
    message: {
      id: 'msg-test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [],
      stop_reason: 'tool_use',
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

const defaultCanUseTool = async (
  tool: Tool<unknown, unknown>,
  input: unknown,
): Promise<PermissionResult> => ({
  behavior: 'allow',
  updatedInput: input,
})

async function collectGen<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = []
  for await (const value of gen) {
    results.push(value)
  }
  return results
}

// ═══════════════════════════════════════════════════════════════════════
// Stream
// ═══════════════════════════════════════════════════════════════════════

describe('Stream', () => {
  test('enqueue then consume yields values in order', async () => {
    const stream = new Stream<number>()
    stream.enqueue(1)
    stream.enqueue(2)
    stream.enqueue(3)
    stream.done()

    const values: number[] = []
    for await (const v of stream) {
      values.push(v)
    }
    expect(values).toEqual([1, 2, 3])
  })

  test('consume waits for enqueue', async () => {
    const stream = new Stream<string>()

    const consumed = (async () => {
      const values: string[] = []
      for await (const v of stream) {
        values.push(v)
      }
      return values
    })()

    stream.enqueue('a')
    stream.enqueue('b')
    stream.done()

    const values = await consumed
    expect(values).toEqual(['a', 'b'])
  })

  test('done() with empty queue completes immediately', async () => {
    const stream = new Stream<number>()
    stream.done()

    const values: number[] = []
    for await (const v of stream) {
      values.push(v)
    }
    expect(values).toEqual([])
  })

  test('error() rejects pending next()', async () => {
    const stream = new Stream<number>()
    const err = new Error('stream error')

    const consumed = (async () => {
      const values: number[] = []
      for await (const v of stream) {
        values.push(v)
      }
      return values
    })()

    stream.error(err)

    await expect(consumed).rejects.toThrow('stream error')
  })

  test('error() after values still throws on next pull', async () => {
    const stream = new Stream<number>()

    stream.enqueue(1)
    stream.error(new Error('late error'))

    const iter = stream[Symbol.asyncIterator]()
    const first = await iter.next()
    expect(first).toEqual({ value: 1, done: false })

    await expect(iter.next()).rejects.toThrow('late error')
  })

  test('enqueue after done is ignored', async () => {
    const stream = new Stream<number>()
    stream.enqueue(1)
    stream.done()
    stream.enqueue(2) // should be ignored

    const values: number[] = []
    for await (const v of stream) {
      values.push(v)
    }
    expect(values).toEqual([1])
  })

  test('multiple done calls are safe', () => {
    const stream = new Stream<number>()
    stream.done()
    stream.done() // no-op
  })
})

// ═══════════════════════════════════════════════════════════════════════
// all (concurrent generator merger)
// ═══════════════════════════════════════════════════════════════════════

describe('all', () => {
  test('empty generators returns immediately', async () => {
    const values = await collectGen(all([]))
    expect(values).toEqual([])
  })

  test('single generator yields all values', async () => {
    async function* gen() {
      yield 1
      yield 2
      yield 3
    }
    const values = await collectGen(all([gen()]))
    expect(values).toEqual([1, 2, 3])
  })

  test('multiple generators yield all values', async () => {
    async function* genA() {
      yield 'a1'
      yield 'a2'
    }
    async function* genB() {
      yield 'b1'
    }
    const values = await collectGen(all([genA(), genB()]))
    expect(values).toHaveLength(3)
    expect(values).toContain('a1')
    expect(values).toContain('a2')
    expect(values).toContain('b1')
  })

  test('respects concurrency cap', async () => {
    let maxConcurrent = 0
    let currentConcurrent = 0

    async function* tracked(id: number) {
      currentConcurrent++
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
      yield id
      // Small delay to let other generators start
      await new Promise(r => setTimeout(r, 5))
      currentConcurrent--
    }

    const gens = [tracked(1), tracked(2), tracked(3), tracked(4), tracked(5)]
    await collectGen(all(gens, 2))

    expect(maxConcurrent).toBeLessThanOrEqual(2)
  })

  test('handles generators that throw', async () => {
    async function* bad(): AsyncGenerator<number> {
      yield 1
      throw new Error('boom')
    }

    const gen = all([bad()])
    const first = await gen.next()
    expect(first.value).toBe(1)

    await expect(gen.next()).rejects.toThrow('boom')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// partitionIntoBatches
// ═══════════════════════════════════════════════════════════════════════

describe('partitionIntoBatches', () => {
  function safeTool(name: string) {
    return buildTool(makeToolDef({ name, isConcurrencySafe: () => true }))
  }
  function unsafeTool(name: string) {
    return buildTool(makeToolDef({ name, isConcurrencySafe: () => false }))
  }

  test('empty blocks returns empty batches', () => {
    const batches = partitionIntoBatches([], [])
    expect(batches).toEqual([])
  })

  test('all safe tools form one concurrent batch', () => {
    const tools = [safeTool('Read'), safeTool('Grep')]
    const blocks = [
      makeToolUseBlock('1', 'Read', {}),
      makeToolUseBlock('2', 'Grep', {}),
      makeToolUseBlock('3', 'Read', {}),
    ]

    const batches = partitionIntoBatches(blocks, tools)
    expect(batches).toHaveLength(1)
    expect(batches[0]!.type).toBe('concurrent')
    expect(batches[0]!.blocks).toHaveLength(3)
  })

  test('all unsafe tools form individual serial batches', () => {
    const tools = [unsafeTool('Edit'), unsafeTool('Bash')]
    const blocks = [
      makeToolUseBlock('1', 'Edit', {}),
      makeToolUseBlock('2', 'Bash', {}),
    ]

    const batches = partitionIntoBatches(blocks, tools)
    expect(batches).toHaveLength(2)
    expect(batches[0]!.type).toBe('serial')
    expect(batches[1]!.type).toBe('serial')
  })

  test('mixed safe/unsafe creates correct batch sequence', () => {
    const tools = [safeTool('Read'), safeTool('Grep'), unsafeTool('Edit')]
    const blocks = [
      makeToolUseBlock('1', 'Read', {}),
      makeToolUseBlock('2', 'Grep', {}),
      makeToolUseBlock('3', 'Edit', {}),
      makeToolUseBlock('4', 'Read', {}),
      makeToolUseBlock('5', 'Read', {}),
    ]

    const batches = partitionIntoBatches(blocks, tools)
    expect(batches).toHaveLength(3)
    expect(batches[0]!.type).toBe('concurrent')
    expect(batches[0]!.blocks).toHaveLength(2)
    expect(batches[1]!.type).toBe('serial')
    expect(batches[1]!.blocks).toHaveLength(1)
    expect(batches[2]!.type).toBe('concurrent')
    expect(batches[2]!.blocks).toHaveLength(2)
  })

  test('unknown tool is treated as not concurrency-safe (fail-closed)', () => {
    const tools = [safeTool('Read')]
    const blocks = [
      makeToolUseBlock('1', 'Read', {}),
      makeToolUseBlock('2', 'Unknown', {}),
      makeToolUseBlock('3', 'Read', {}),
    ]

    const batches = partitionIntoBatches(blocks, tools)
    expect(batches).toHaveLength(3)
    expect(batches[0]!.type).toBe('concurrent')
    expect(batches[1]!.type).toBe('serial')
    expect(batches[2]!.type).toBe('concurrent')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// isEmptyContent / contentSize / maybeTruncateLargeResult
// ═══════════════════════════════════════════════════════════════════════

describe('result-size', () => {
  describe('isEmptyContent', () => {
    test('null/undefined are empty', () => {
      expect(isEmptyContent(undefined)).toBe(true)
      expect(isEmptyContent(null as unknown as undefined)).toBe(true)
    })

    test('empty string is empty', () => {
      expect(isEmptyContent('')).toBe(true)
      expect(isEmptyContent('   ')).toBe(true)
    })

    test('non-empty string is not empty', () => {
      expect(isEmptyContent('hello')).toBe(false)
    })

    test('empty array is empty', () => {
      expect(isEmptyContent([])).toBe(true)
    })

    test('array with empty text block is empty', () => {
      expect(isEmptyContent([{ type: 'text' as const, text: '' }])).toBe(true)
    })

    test('array with non-empty text block is not empty', () => {
      expect(isEmptyContent([{ type: 'text' as const, text: 'hello' }])).toBe(false)
    })
  })

  describe('contentSize', () => {
    test('null/undefined return 0', () => {
      expect(contentSize(undefined)).toBe(0)
    })

    test('string returns length', () => {
      expect(contentSize('hello')).toBe(5)
    })

    test('array sums text block lengths', () => {
      expect(contentSize([
        { type: 'text' as const, text: 'abc' },
        { type: 'text' as const, text: 'de' },
      ])).toBe(5)
    })
  })

  describe('maybeTruncateLargeResult', () => {
    test('small result passes through unchanged', () => {
      const block = {
        type: 'tool_result' as const,
        tool_use_id: 'test',
        content: 'small',
      }
      expect(maybeTruncateLargeResult(block, 'Test', 100)).toBe(block)
    })

    test('large string result is truncated with preview', () => {
      const longContent = 'x'.repeat(10_000)
      const block = {
        type: 'tool_result' as const,
        tool_use_id: 'test',
        content: longContent,
      }

      const result = maybeTruncateLargeResult(block, 'BigTool', 5_000)
      expect(typeof result.content).toBe('string')
      const content = result.content as string
      expect(content).toContain('Output too large')
      expect(content).toContain('10000 chars')
      expect(content).toContain('Preview:')
      expect(content.length).toBeLessThan(longContent.length)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// runToolUse (single tool executor)
// ═══════════════════════════════════════════════════════════════════════

describe('runToolUse', () => {
  test('executes tool and returns tool_result event', async () => {
    const tool = buildTool(makeToolDef())
    const context = makeContext([tool])
    const block = makeToolUseBlock('t1', 'Echo', { message: 'hello' })

    const events = await collectGen(
      runToolUse(block, [tool], defaultCanUseTool, context, 'asst-uuid'),
    )

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.type).toBe('tool_result')
    if (event.type === 'tool_result') {
      expect(event.message.type).toBe('user')
      expect(event.message.isMeta).toBe(true)
      expect(event.message.sourceToolAssistantUUID).toBe('asst-uuid')
      expect(event.contextModifiers).toHaveLength(0)
    }
  })

  test('returns error for unknown tool', async () => {
    const context = makeContext([])
    const block = makeToolUseBlock('t1', 'Unknown', {})

    const events = await collectGen(
      runToolUse(block, [], defaultCanUseTool, context, 'asst-uuid'),
    )

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.type).toBe('tool_result')
    if (event.type === 'tool_result') {
      const content = event.message.message.content
      expect(Array.isArray(content)).toBe(true)
      if (Array.isArray(content)) {
        const block = content[0]!
        expect(block).toHaveProperty('is_error', true)
        expect((block as { content: string }).content).toContain('Tool not found: Unknown')
      }
    }
  })

  test('returns error when aborted', async () => {
    const tool = buildTool(makeToolDef())
    const controller = new AbortController()
    controller.abort()
    const context = makeContext([tool], { abortController: controller })
    const block = makeToolUseBlock('t1', 'Echo', { message: 'hello' })

    const events = await collectGen(
      runToolUse(block, [tool], defaultCanUseTool, context, 'asst-uuid'),
    )

    expect(events).toHaveLength(1)
    if (events[0]!.type === 'tool_result') {
      const content = events[0]!.message.message.content
      if (Array.isArray(content)) {
        expect((content[0] as { content: string }).content).toContain('Aborted')
      }
    }
  })

  test('validates input with Zod and returns error on failure', async () => {
    const tool = buildTool(makeToolDef())
    const context = makeContext([tool])
    const block = makeToolUseBlock('t1', 'Echo', { message: 123 }) // wrong type

    const events = await collectGen(
      runToolUse(block, [tool], defaultCanUseTool, context, 'asst-uuid'),
    )

    expect(events).toHaveLength(1)
    if (events[0]!.type === 'tool_result') {
      const content = events[0]!.message.message.content
      if (Array.isArray(content)) {
        const text = (content[0] as { content: string }).content
        expect(text).toContain('Input validation error')
      }
    }
  })

  test('runs custom validateInput and returns error on failure', async () => {
    const tool = buildTool(makeToolDef({
      async validateInput(input) {
        if (input.message === 'forbidden') {
          return { result: false, message: 'Forbidden input' }
        }
        return { result: true }
      },
    }))
    const context = makeContext([tool])
    const block = makeToolUseBlock('t1', 'Echo', { message: 'forbidden' })

    const events = await collectGen(
      runToolUse(block, [tool], defaultCanUseTool, context, 'asst-uuid'),
    )

    expect(events).toHaveLength(1)
    if (events[0]!.type === 'tool_result') {
      const content = events[0]!.message.message.content
      if (Array.isArray(content)) {
        expect((content[0] as { content: string }).content).toContain('Forbidden input')
      }
    }
  })

  test('returns error when permission is denied', async () => {
    const tool = buildTool(makeToolDef())
    const context = makeContext([tool])
    const block = makeToolUseBlock('t1', 'Echo', { message: 'hello' })

    const denyCanUseTool = async (): Promise<PermissionResult> => ({
      behavior: 'deny',
      message: 'Not allowed',
    })

    const events = await collectGen(
      runToolUse(block, [tool], denyCanUseTool, context, 'asst-uuid'),
    )

    expect(events).toHaveLength(1)
    if (events[0]!.type === 'tool_result') {
      const content = events[0]!.message.message.content
      if (Array.isArray(content)) {
        expect((content[0] as { content: string }).content).toContain('Not allowed')
      }
    }
  })

  test('treats ask permission as deny for MVP', async () => {
    const tool = buildTool(makeToolDef())
    const context = makeContext([tool])
    const block = makeToolUseBlock('t1', 'Echo', { message: 'hello' })

    const askCanUseTool = async (): Promise<PermissionResult> => ({
      behavior: 'ask',
      message: 'Needs confirmation',
    })

    const events = await collectGen(
      runToolUse(block, [tool], askCanUseTool, context, 'asst-uuid'),
    )

    expect(events).toHaveLength(1)
    if (events[0]!.type === 'tool_result') {
      const content = events[0]!.message.message.content
      if (Array.isArray(content)) {
        expect((content[0] as { content: string }).content).toContain('Permission required')
      }
    }
  })

  test('catches tool execution errors', async () => {
    const tool = buildTool(makeToolDef({
      async call() {
        throw new Error('disk full')
      },
    }))
    const context = makeContext([tool])
    const block = makeToolUseBlock('t1', 'Echo', { message: 'hello' })

    const events = await collectGen(
      runToolUse(block, [tool], defaultCanUseTool, context, 'asst-uuid'),
    )

    expect(events).toHaveLength(1)
    if (events[0]!.type === 'tool_result') {
      const content = events[0]!.message.message.content
      if (Array.isArray(content)) {
        expect((content[0] as { content: string }).content).toContain('disk full')
      }
    }
  })

  test('handles empty tool result', async () => {
    const tool = buildTool(makeToolDef({
      async call() {
        return { data: '' }
      },
      mapToolResultToToolResultBlockParam(output, toolUseID) {
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUseID,
          content: output,
        }
      },
    }))
    const context = makeContext([tool])
    const block = makeToolUseBlock('t1', 'Echo', { message: 'hello' })

    const events = await collectGen(
      runToolUse(block, [tool], defaultCanUseTool, context, 'asst-uuid'),
    )

    expect(events).toHaveLength(1)
    if (events[0]!.type === 'tool_result') {
      const content = events[0]!.message.message.content
      if (Array.isArray(content)) {
        const text = (content[0] as { content: string }).content
        expect(text).toContain('Echo completed with no output')
      }
    }
  })

  test('collects context modifier from tool result', async () => {
    const modifier = (ctx: ToolUseContext) => ({ ...ctx })
    const tool = buildTool(makeToolDef({
      async call(input) {
        return {
          data: input.message,
          contextModifier: modifier,
        }
      },
    }))
    const context = makeContext([tool])
    const block = makeToolUseBlock('t1', 'Echo', { message: 'hello' })

    const events = await collectGen(
      runToolUse(block, [tool], defaultCanUseTool, context, 'asst-uuid'),
    )

    expect(events).toHaveLength(1)
    if (events[0]!.type === 'tool_result') {
      expect(events[0]!.contextModifiers).toHaveLength(1)
      expect(events[0]!.contextModifiers[0]!.toolUseID).toBe('t1')
    }
  })

  test('passes updatedInput from permission check to tool.call', async () => {
    const callSpy = mock(async (input: { message: string }) => ({
      data: input.message,
    }))

    const tool = buildTool(makeToolDef({ call: callSpy }))
    const context = makeContext([tool])
    const block = makeToolUseBlock('t1', 'Echo', { message: 'original' })

    const transformingCanUseTool = async (
      _tool: Tool<unknown, unknown>,
      input: unknown,
    ): Promise<PermissionResult> => ({
      behavior: 'allow',
      updatedInput: { message: 'transformed' },
    })

    await collectGen(
      runToolUse(block, [tool], transformingCanUseTool, context, 'asst-uuid'),
    )

    expect(callSpy).toHaveBeenCalledTimes(1)
    const calledInput = callSpy.mock.calls[0]![0]
    expect(calledInput).toEqual({ message: 'transformed' })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// runTools (orchestration layer)
// ═══════════════════════════════════════════════════════════════════════

describe('runTools', () => {
  test('executes a single tool and yields result', async () => {
    const tool = buildTool(makeToolDef())
    const context = makeContext([tool])
    const assistantMsg = makeAssistantMessage()
    const blocks = [makeToolUseBlock('t1', 'Echo', { message: 'hello' })]

    const events = await collectGen(
      runTools(blocks, assistantMsg, defaultCanUseTool, context),
    )

    const results = events.filter(e => e.type === 'tool_result')
    expect(results).toHaveLength(1)
  })

  test('empty blocks yields nothing', async () => {
    const context = makeContext([])
    const assistantMsg = makeAssistantMessage()

    const events = await collectGen(
      runTools([], assistantMsg, defaultCanUseTool, context),
    )

    expect(events).toHaveLength(0)
  })

  test('concurrent-safe tools run in same batch', async () => {
    const callOrder: string[] = []

    const tool = buildTool(makeToolDef({
      name: 'SafeTool',
      isConcurrencySafe: () => true,
      async call(input) {
        callOrder.push(input.message)
        return { data: input.message }
      },
    }))

    const context = makeContext([tool])
    const assistantMsg = makeAssistantMessage()
    const blocks = [
      makeToolUseBlock('t1', 'SafeTool', { message: 'a' }),
      makeToolUseBlock('t2', 'SafeTool', { message: 'b' }),
      makeToolUseBlock('t3', 'SafeTool', { message: 'c' }),
    ]

    const events = await collectGen(
      runTools(blocks, assistantMsg, defaultCanUseTool, context),
    )

    const results = events.filter(e => e.type === 'tool_result')
    expect(results).toHaveLength(3)
    // All should have been called (order may vary due to concurrency)
    expect(callOrder.sort()).toEqual(['a', 'b', 'c'])
  })

  test('non-safe tools run serially in separate batches', async () => {
    const callOrder: string[] = []

    const tool = buildTool(makeToolDef({
      name: 'UnsafeTool',
      isConcurrencySafe: () => false,
      async call(input) {
        callOrder.push(input.message)
        return { data: input.message }
      },
    }))

    const context = makeContext([tool])
    const assistantMsg = makeAssistantMessage()
    const blocks = [
      makeToolUseBlock('t1', 'UnsafeTool', { message: 'first' }),
      makeToolUseBlock('t2', 'UnsafeTool', { message: 'second' }),
    ]

    const events = await collectGen(
      runTools(blocks, assistantMsg, defaultCanUseTool, context),
    )

    const results = events.filter(e => e.type === 'tool_result')
    expect(results).toHaveLength(2)
    // Serial execution: must be in order
    expect(callOrder).toEqual(['first', 'second'])
  })

  test('mixed safe/unsafe maintains correct ordering', async () => {
    const callOrder: string[] = []

    const readTool = buildTool(makeToolDef({
      name: 'Read',
      isConcurrencySafe: () => true,
      async call(input) {
        callOrder.push(`read-${input.message}`)
        return { data: input.message }
      },
    }))

    const editTool = buildTool(makeToolDef({
      name: 'Edit',
      isConcurrencySafe: () => false,
      async call(input) {
        callOrder.push(`edit-${input.message}`)
        return { data: input.message }
      },
    }))

    const context = makeContext([readTool, editTool])
    const assistantMsg = makeAssistantMessage()
    const blocks = [
      makeToolUseBlock('t1', 'Read', { message: '1' }),
      makeToolUseBlock('t2', 'Read', { message: '2' }),
      makeToolUseBlock('t3', 'Edit', { message: '3' }),
      makeToolUseBlock('t4', 'Read', { message: '4' }),
    ]

    const events = await collectGen(
      runTools(blocks, assistantMsg, defaultCanUseTool, context),
    )

    const results = events.filter(e => e.type === 'tool_result')
    expect(results).toHaveLength(4)

    // Edit must come after reads 1&2 and before read 4
    const editIdx = callOrder.indexOf('edit-3')
    const read4Idx = callOrder.indexOf('read-4')
    expect(editIdx).toBeGreaterThanOrEqual(2) // after both reads
    expect(read4Idx).toBeGreaterThan(editIdx)
  })

  test('context modifiers applied after concurrent batch', async () => {
    let modifierCalls = 0

    const tool = buildTool(makeToolDef({
      name: 'Modifier',
      isConcurrencySafe: () => true,
      async call(input) {
        return {
          data: input.message,
          contextModifier: (ctx: ToolUseContext) => {
            modifierCalls++
            return ctx
          },
        }
      },
    }))

    const context = makeContext([tool])
    const assistantMsg = makeAssistantMessage()
    const blocks = [
      makeToolUseBlock('t1', 'Modifier', { message: 'a' }),
      makeToolUseBlock('t2', 'Modifier', { message: 'b' }),
    ]

    const events = await collectGen(
      runTools(blocks, assistantMsg, defaultCanUseTool, context),
    )

    // Should have context_update events after the concurrent batch
    const contextUpdates = events.filter(e => e.type === 'context_update')
    expect(contextUpdates.length).toBeGreaterThanOrEqual(1)
    expect(modifierCalls).toBe(2) // both modifiers applied
  })

  test('context modifiers applied immediately for serial batch', async () => {
    const appliedContexts: ToolUseContext[] = []

    const tool = buildTool(makeToolDef({
      name: 'Serial',
      isConcurrencySafe: () => false,
      async call(input, context) {
        appliedContexts.push(context)
        return {
          data: input.message,
          contextModifier: (ctx: ToolUseContext) => ({
            ...ctx,
            messages: [...ctx.messages], // shallow copy to detect change
          }),
        }
      },
    }))

    const context = makeContext([tool])
    const assistantMsg = makeAssistantMessage()
    const blocks = [
      makeToolUseBlock('t1', 'Serial', { message: 'a' }),
      makeToolUseBlock('t2', 'Serial', { message: 'b' }),
    ]

    const events = await collectGen(
      runTools(blocks, assistantMsg, defaultCanUseTool, context),
    )

    const results = events.filter(e => e.type === 'tool_result')
    expect(results).toHaveLength(2)
    const contextUpdates = events.filter(e => e.type === 'context_update')
    expect(contextUpdates).toHaveLength(2) // one per serial tool
  })

  test('returns error result for every tool_use block even on error', async () => {
    const tool = buildTool(makeToolDef({
      async call() {
        throw new Error('always fails')
      },
    }))
    const context = makeContext([tool])
    const assistantMsg = makeAssistantMessage()
    const blocks = [
      makeToolUseBlock('t1', 'Echo', { message: 'a' }),
      makeToolUseBlock('t2', 'Echo', { message: 'b' }),
    ]

    const events = await collectGen(
      runTools(blocks, assistantMsg, defaultCanUseTool, context),
    )

    // Both should have tool_result events (even though both errored)
    const results = events.filter(e => e.type === 'tool_result')
    expect(results).toHaveLength(2)
  })

  test('handles tool not found gracefully', async () => {
    const context = makeContext([])
    const assistantMsg = makeAssistantMessage()
    const blocks = [makeToolUseBlock('t1', 'NonExistent', { message: 'hello' })]

    const events = await collectGen(
      runTools(blocks, assistantMsg, defaultCanUseTool, context),
    )

    const results = events.filter(e => e.type === 'tool_result')
    expect(results).toHaveLength(1)
  })
})
