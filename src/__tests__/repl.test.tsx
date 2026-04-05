import { describe, test, expect } from 'bun:test'
import { renderTest } from '../testing/render.js'
import { REPL, type REPLDeps } from '../repl.js'
import type { QueryDeps, CallModelParams } from '../services/agent/types.js'
import type { ToolBatchEvent } from '../services/tools/execution/types.js'
import type { Tool } from '../services/tools/types.js'
import type { AssistantMessage } from '../types/message.js'
import type { QueryEvent } from '../types/streamEvents.js'
import type { ContentBlock } from '@anthropic-ai/sdk/resources/messages/messages'

const TICK = 100

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeAssistantMessage(text: string): AssistantMessage {
  return {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text }] as ContentBlock[],
      stop_reason: 'end_turn',
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
    requestId: undefined,
  }
}

function createFakeDeps(responses: string[]): REPLDeps {
  let callIndex = 0

  const tools: Tool<unknown, unknown>[] = []

  return {
    tools,
    createQueryDeps: (): QueryDeps => ({
      async *callModel(_params: CallModelParams): AsyncGenerator<QueryEvent> {
        const text = responses[callIndex++] ?? 'No more responses'
        yield makeAssistantMessage(text)
      },
      async *executeToolBatch(): AsyncGenerator<ToolBatchEvent> {
        // No tool calls in these tests
      },
      uuid: () => crypto.randomUUID(),
    }),
  }
}

function createErrorDeps(errorMessage: string): REPLDeps {
  return {
    tools: [],
    createQueryDeps: (): QueryDeps => ({
      async *callModel(): AsyncGenerator<QueryEvent> {
        throw new Error(errorMessage)
      },
      async *executeToolBatch(): AsyncGenerator<ToolBatchEvent> {},
      uuid: () => crypto.randomUUID(),
    }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('REPL', () => {
  test('renders the prompt', () => {
    const { lastFrame } = renderTest(<REPL deps={createFakeDeps([])} />)
    expect(lastFrame()).toContain('❯')
  })

  test('displays user input and assistant response', async () => {
    const deps = createFakeDeps(['Hello! How can I help?'])
    const { lastFrame, stdin } = renderTest(<REPL deps={deps} />)

    stdin.write('hi there')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK * 3))

    const frame = lastFrame()!
    expect(frame).toContain('> hi there')
    expect(frame).toContain('Hello! How can I help?')
  })

  test('shows loading indicator while agent is working', async () => {
    // Use a slow deps that lets us observe loading state
    let resolveResponse: (() => void) | undefined
    const deps: REPLDeps = {
      tools: [],
      createQueryDeps: (): QueryDeps => ({
        async *callModel(): AsyncGenerator<QueryEvent> {
          await new Promise<void>(r => { resolveResponse = r })
          yield makeAssistantMessage('done')
        },
        async *executeToolBatch(): AsyncGenerator<ToolBatchEvent> {},
        uuid: () => crypto.randomUUID(),
      }),
    }

    const { lastFrame, stdin } = renderTest(<REPL deps={deps} />)

    stdin.write('test')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK))

    expect(lastFrame()).toContain('Thinking...')

    resolveResponse?.()
    await new Promise(r => setTimeout(r, TICK * 2))

    expect(lastFrame()).not.toContain('Thinking...')
  })

  test('displays error messages on failure', async () => {
    const deps = createErrorDeps('API connection failed')
    const { lastFrame, stdin } = renderTest(<REPL deps={deps} />)

    stdin.write('hello')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK * 3))

    const frame = lastFrame()!
    expect(frame).toContain('API connection failed')
  })

  test('clears input after submit', async () => {
    const deps = createFakeDeps(['response'])
    const { lastFrame, stdin } = renderTest(<REPL deps={deps} />)

    stdin.write('some input')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK * 3))

    const frame = lastFrame()!
    const lines = frame.split('\n')
    const promptLine = lines[lines.length - 1]!
    expect(promptLine).not.toContain('some input')
  })

  test('ignores empty input', async () => {
    const deps = createFakeDeps(['should not appear'])
    const { lastFrame, stdin } = renderTest(<REPL deps={deps} />)

    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK * 2))

    const frame = lastFrame()!
    expect(frame).not.toContain('should not appear')
  })

  test('accumulates multiple turns', async () => {
    const deps = createFakeDeps(['first response', 'second response'])
    const { lastFrame, stdin } = renderTest(<REPL deps={deps} />)

    stdin.write('first')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK * 3))

    stdin.write('second')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK * 3))

    const frame = lastFrame()!
    expect(frame).toContain('> first')
    expect(frame).toContain('first response')
    expect(frame).toContain('> second')
    expect(frame).toContain('second response')
  })
})
