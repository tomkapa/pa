import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  __getCollectedSpansForTests,
  __resetTracerForTests,
  endInteractionSpan,
  endLLMRequestSpan,
  endToolSpan,
  flushTracer,
  startInteractionSpan,
  startLLMRequestSpan,
  startToolSpan,
} from '../services/observability/tracing.js'
import { snapshotEnv } from '../testing/env-snapshot.js'

let restoreEnv: () => void

beforeEach(() => {
  restoreEnv = snapshotEnv(['NODE_ENV', 'OTEL_TRACES_EXPORTER'])
  process.env['NODE_ENV'] = 'test'
  delete process.env['OTEL_TRACES_EXPORTER']
  __resetTracerForTests()
})

afterEach(() => {
  __resetTracerForTests()
  restoreEnv()
})

describe('observability/tracing', () => {
  test('startInteractionSpan + endInteractionSpan emits a span with expected attributes', async () => {
    const span = startInteractionSpan('hello world')
    endInteractionSpan(span, { finalTokenCount: 42 })
    await flushTracer()

    const spans = __getCollectedSpansForTests()
    const interactions = spans.filter(s => s.name === 'interaction')
    expect(interactions.length).toBe(1)
    const attrs = interactions[0]!.attributes
    expect(attrs['session_id']).toBeDefined()
    expect(attrs['turn_number']).toBe(1)
    expect(attrs['user_input_length']).toBe('hello world'.length)
    expect(attrs['final_token_count']).toBe(42)
  })

  test('llm_request span attaches usage attributes on end', async () => {
    const interaction = startInteractionSpan('q')
    const llm = startLLMRequestSpan('claude-test', 3)
    endLLMRequestSpan(llm, {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 25,
      stopReason: 'end_turn',
      requestId: 'req_abc',
    })
    endInteractionSpan(interaction)
    await flushTracer()

    const spans = __getCollectedSpansForTests()
    const llmSpan = spans.find(s => s.name === 'llm_request')!
    expect(llmSpan).toBeDefined()
    expect(llmSpan.attributes['model']).toBe('claude-test')
    expect(llmSpan.attributes['message_count']).toBe(3)
    expect(llmSpan.attributes['input_tokens']).toBe(100)
    expect(llmSpan.attributes['output_tokens']).toBe(50)
    expect(llmSpan.attributes['cache_read_tokens']).toBe(25)
    expect(llmSpan.attributes['stop_reason']).toBe('end_turn')
    expect(llmSpan.attributes['request_id']).toBe('req_abc')
  })

  test('tool span captures tool name, input size, and success', async () => {
    const interaction = startInteractionSpan('test')
    const tool = startToolSpan('BashTool', { command: 'ls -la' })
    endToolSpan(tool, { success: true, outputSize: 256 })
    endInteractionSpan(interaction)
    await flushTracer()

    const spans = __getCollectedSpansForTests()
    const toolSpan = spans.find(s => s.name === 'tool')!
    expect(toolSpan).toBeDefined()
    expect(toolSpan.attributes['tool_name']).toBe('BashTool')
    expect(toolSpan.attributes['success']).toBe(true)
    expect(toolSpan.attributes['output_size']).toBe(256)
    // input_size is a cheap byte estimate, not an exact JSON length — just
    // assert it's positive and roughly tracks payload size.
    expect(Number(toolSpan.attributes['input_size'])).toBeGreaterThan(0)
  })

  test('turn counter increments per interaction', async () => {
    endInteractionSpan(startInteractionSpan('one'))
    endInteractionSpan(startInteractionSpan('two'))
    endInteractionSpan(startInteractionSpan('three'))
    await flushTracer()

    const interactions = __getCollectedSpansForTests().filter(s => s.name === 'interaction')
    expect(interactions.map(s => s.attributes['turn_number'])).toEqual([1, 2, 3])
  })
})
