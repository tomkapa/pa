import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SpanStatusCode } from '@opentelemetry/api'
import { BatchSpanProcessor, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
import {
  ATTR,
  GEN_AI_SYSTEM_ANTHROPIC,
  OBS_TYPE_GENERATION,
  OP_CHAT,
  OP_EXECUTE_TOOL,
} from '../services/observability/attributes.js'
import {
  __getCollectedSpansForTests,
  __resetTracerForTests,
  buildLangfuseAuthHeader,
  buildLangfuseHeaders,
  buildSpanProcessors,
  endInteractionSpan,
  endLLMRequestSpan,
  endToolSpan,
  flushTracer,
  resolveOTLPTracesEndpoint,
  startInteractionSpan,
  startLLMRequestSpan,
  startToolSpan,
} from '../services/observability/tracing.js'
import { LANGFUSE_OTEL_DEFAULT_URL } from '../services/observability/attributes.js'
import { snapshotEnv } from '../testing/env-snapshot.js'

let restoreEnv: () => void

beforeEach(() => {
  restoreEnv = snapshotEnv([
    'NODE_ENV',
    'OTEL_TRACES_EXPORTER',
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    'OTEL_EXPORTER_OTLP_HEADERS',
    'LANGFUSE_PUBLIC_KEY',
    'LANGFUSE_SECRET_KEY',
  ])
  process.env['NODE_ENV'] = 'test'
  delete process.env['OTEL_TRACES_EXPORTER']
  delete process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
  delete process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']
  delete process.env['OTEL_EXPORTER_OTLP_HEADERS']
  delete process.env['LANGFUSE_PUBLIC_KEY']
  delete process.env['LANGFUSE_SECRET_KEY']
  __resetTracerForTests()
})

afterEach(() => {
  __resetTracerForTests()
  restoreEnv()
})

describe('observability/tracing', () => {
  test('startInteractionSpan + endInteractionSpan emits a span with expected attributes', async () => {
    const span = startInteractionSpan('hello world')
    endInteractionSpan(span, { finalTokenCount: 42, output: 'all done' })
    await flushTracer()

    const spans = __getCollectedSpansForTests()
    const interactions = spans.filter(s => s.name === 'interaction')
    expect(interactions.length).toBe(1)
    const attrs = interactions[0]!.attributes
    // Both Langfuse and OpenInference/Phoenix session keys are set on the
    // same span so the trace works in either backend without reshaping.
    expect(attrs[ATTR.LANGFUSE_SESSION_ID]).toBeDefined()
    expect(attrs[ATTR.SESSION_ID]).toBeDefined()
    expect(attrs[ATTR.LANGFUSE_SESSION_ID]).toBe(attrs[ATTR.SESSION_ID] as string)
    expect(attrs[ATTR.PA_TURN_NUMBER]).toBe(1)
    expect(attrs[ATTR.PA_USER_INPUT_LENGTH]).toBe('hello world'.length)
    expect(attrs[ATTR.PA_FINAL_TOKEN_COUNT]).toBe(42)
    // User input and final output feed the Langfuse Input/Output panels.
    expect(attrs[ATTR.LANGFUSE_OBSERVATION_INPUT]).toBe('hello world')
    expect(attrs[ATTR.LANGFUSE_OBSERVATION_OUTPUT]).toBe('all done')
  })

  test('llm_request span uses GenAI semconv attributes and nests under interaction', async () => {
    const interaction = startInteractionSpan('q')
    const messages = [{ role: 'user', content: 'hi' }]
    const llm = startLLMRequestSpan({
      model: 'claude-test',
      messageCount: 3,
      parent: interaction,
      input: messages,
    })
    endLLMRequestSpan(llm, {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 25,
      cacheCreationTokens: 10,
      stopReason: 'end_turn',
      requestId: 'req_abc',
      output: [{ type: 'text', text: 'hello back' }],
    })
    endInteractionSpan(interaction)
    await flushTracer()

    const spans = __getCollectedSpansForTests()
    // Span name follows the GenAI convention: "<operation> <model>"
    const llmSpan = spans.find(s => s.name === `${OP_CHAT} claude-test`)!
    const interactionSpan = spans.find(s => s.name === 'interaction')!
    expect(llmSpan).toBeDefined()
    expect(interactionSpan).toBeDefined()

    // CRITICAL: the llm_request span must be a child of the interaction span,
    // otherwise Langfuse/Jaeger render a flat list of disconnected roots.
    expect(llmSpan.parentSpanContext?.spanId).toBe(
      interactionSpan.spanContext().spanId,
    )
    expect(llmSpan.spanContext().traceId).toBe(
      interactionSpan.spanContext().traceId,
    )

    const attrs = llmSpan.attributes
    expect(attrs[ATTR.GEN_AI_SYSTEM]).toBe(GEN_AI_SYSTEM_ANTHROPIC)
    expect(attrs[ATTR.GEN_AI_OPERATION_NAME]).toBe(OP_CHAT)
    expect(attrs[ATTR.GEN_AI_REQUEST_MODEL]).toBe('claude-test')
    // Langfuse observation type unlocks the Generation panel (cost/tokens)
    expect(attrs[ATTR.LANGFUSE_OBSERVATION_TYPE]).toBe(OBS_TYPE_GENERATION)
    expect(attrs[ATTR.PA_MESSAGES_COUNT]).toBe(3)
    expect(attrs[ATTR.GEN_AI_USAGE_INPUT_TOKENS]).toBe(100)
    expect(attrs[ATTR.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(50)
    expect(attrs[ATTR.GEN_AI_USAGE_CACHE_READ]).toBe(25)
    expect(attrs[ATTR.GEN_AI_USAGE_CACHE_CREATION]).toBe(10)
    // finish_reasons is an array per spec, even for a single reason
    expect(attrs[ATTR.GEN_AI_RESPONSE_FINISH_REASONS]).toEqual(['end_turn'])
    expect(attrs[ATTR.GEN_AI_RESPONSE_ID]).toBe('req_abc')
    // Input/output payloads are JSON-serialized into the langfuse panels.
    expect(attrs[ATTR.LANGFUSE_OBSERVATION_INPUT]).toBe(JSON.stringify(messages))
    expect(attrs[ATTR.LANGFUSE_OBSERVATION_OUTPUT]).toBe(
      JSON.stringify([{ type: 'text', text: 'hello back' }]),
    )
  })

  test('tool span uses GenAI semconv attributes and nests under interaction', async () => {
    const interaction = startInteractionSpan('test')
    const toolInput = { command: 'ls -la' }
    const toolOutput = 'file1\nfile2\n'
    const tool = startToolSpan({ toolName: 'BashTool', input: toolInput, parent: interaction })
    // No explicit outputSize — the tracer derives it from `output` so the
    // caller doesn't have to measure the same data twice.
    endToolSpan(tool, { success: true, output: toolOutput })
    endInteractionSpan(interaction)
    await flushTracer()

    const spans = __getCollectedSpansForTests()
    const toolSpan = spans.find(s => s.name === `${OP_EXECUTE_TOOL} BashTool`)!
    const interactionSpan = spans.find(s => s.name === 'interaction')!
    expect(toolSpan).toBeDefined()

    // Parent-child check.
    expect(toolSpan.parentSpanContext?.spanId).toBe(
      interactionSpan.spanContext().spanId,
    )
    expect(toolSpan.spanContext().traceId).toBe(
      interactionSpan.spanContext().traceId,
    )

    const attrs = toolSpan.attributes
    expect(attrs[ATTR.GEN_AI_OPERATION_NAME]).toBe(OP_EXECUTE_TOOL)
    expect(attrs[ATTR.GEN_AI_TOOL_NAME]).toBe('BashTool')
    expect(attrs[ATTR.PA_TOOL_SUCCESS]).toBe(true)
    // Output size derived from the output payload.
    expect(Number(attrs[ATTR.PA_TOOL_OUTPUT_SIZE])).toBe(toolOutput.length)
    // Input size is a cheap byte estimate, not an exact JSON length — just
    // assert it's positive and roughly tracks payload size.
    expect(Number(attrs[ATTR.PA_TOOL_INPUT_SIZE])).toBeGreaterThan(0)
    // Langfuse Input/Output panels.
    expect(attrs[ATTR.LANGFUSE_OBSERVATION_INPUT]).toBe(JSON.stringify(toolInput))
    expect(attrs[ATTR.LANGFUSE_OBSERVATION_OUTPUT]).toBe(toolOutput)
  })

  test('spans without a parent fall back to root (no crash)', async () => {
    // Legacy behaviour — if a caller forgets the parent argument, spans
    // should still work, just as disconnected roots. Guards the default
    // fallback in childContext().
    const llm = startLLMRequestSpan({ model: 'claude-test', messageCount: 1 })
    endLLMRequestSpan(llm, { stopReason: 'end_turn' })
    await flushTracer()

    const llmSpan = __getCollectedSpansForTests().find(
      s => s.name === `${OP_CHAT} claude-test`,
    )!
    expect(llmSpan).toBeDefined()
    // Root span — no parent span context.
    expect(llmSpan.parentSpanContext).toBeUndefined()
  })

  test('tool span sets ERROR status when success=false', async () => {
    const interaction = startInteractionSpan('test')
    const tool = startToolSpan({
      toolName: 'BashTool',
      input: { command: 'false' },
      parent: interaction,
    })
    endToolSpan(tool, { success: false, outputSize: 4 })
    endInteractionSpan(interaction)
    await flushTracer()

    const toolSpan = __getCollectedSpansForTests().find(
      s => s.name === `${OP_EXECUTE_TOOL} BashTool`,
    )!
    expect(toolSpan).toBeDefined()
    expect(toolSpan.attributes[ATTR.PA_TOOL_SUCCESS]).toBe(false)
    expect(toolSpan.status.code).toBe(SpanStatusCode.ERROR)
  })

  test('plain-string observation values longer than 32KiB are tail-truncated', async () => {
    // Strings get the fast path: just slice + marker. No JSON stringify.
    const huge = 'x'.repeat(50 * 1024)
    const interaction = startInteractionSpan('t')
    const tool = startToolSpan({
      toolName: 'BashTool',
      input: 'normal input',
      parent: interaction,
    })
    endToolSpan(tool, { success: true, output: huge })
    endInteractionSpan(interaction)
    await flushTracer()

    const toolSpan = __getCollectedSpansForTests().find(
      s => s.name === `${OP_EXECUTE_TOOL} BashTool`,
    )!
    const output = String(toolSpan.attributes[ATTR.LANGFUSE_OBSERVATION_OUTPUT])
    expect(output.length).toBeLessThan(50 * 1024)
    expect(output).toContain('…[truncated')
  })

  test('structured observation values past the 2x budget are omitted, not stringified', async () => {
    // Efficiency guard: a huge object is NOT run through JSON.stringify
    // just to throw 95% of the result away. estimateSize short-circuits
    // into a `[large payload omitted]` placeholder. This matters because
    // real tool outputs (Read on a big file, Bash on a log dump) can be
    // many MB — we'd allocate the full serialized string for nothing.
    const huge = 'x'.repeat(100 * 1024) // ~100 KiB, well past 2 * 32 KiB
    const interaction = startInteractionSpan('t')
    const tool = startToolSpan({
      toolName: 'BashTool',
      input: { command: huge, extra: huge },
      parent: interaction,
    })
    endToolSpan(tool, { success: true })
    endInteractionSpan(interaction)
    await flushTracer()

    const toolSpan = __getCollectedSpansForTests().find(
      s => s.name === `${OP_EXECUTE_TOOL} BashTool`,
    )!
    const input = String(toolSpan.attributes[ATTR.LANGFUSE_OBSERVATION_INPUT])
    expect(input).toContain('[large payload omitted')
    expect(input.length).toBeLessThan(200)
  })

  test('turn counter increments per interaction', async () => {
    endInteractionSpan(startInteractionSpan('one'))
    endInteractionSpan(startInteractionSpan('two'))
    endInteractionSpan(startInteractionSpan('three'))
    await flushTracer()

    const interactions = __getCollectedSpansForTests().filter(s => s.name === 'interaction')
    expect(interactions.map(s => s.attributes[ATTR.PA_TURN_NUMBER])).toEqual([1, 2, 3])
  })
})

describe('observability/tracing — OTLP exporter wiring', () => {
  test('buildLangfuseAuthHeader constructs a correct Basic auth value', () => {
    const header = buildLangfuseAuthHeader('pk-lf-test', 'sk-lf-test')
    const expected = 'Basic ' + Buffer.from('pk-lf-test:sk-lf-test').toString('base64')
    expect(header).toBe(expected)
  })

  test('buildLangfuseHeaders includes x-langfuse-ingestion-version=4', () => {
    // Per Langfuse docs, this header is required for real-time display in
    // Langfuse Cloud Fast Preview. Missing it is the #1 "traces not
    // appearing" footgun so the test locks it in.
    const headers = buildLangfuseHeaders('pk-lf-test', 'sk-lf-test')
    expect(headers['Authorization']).toBe(
      'Basic ' + Buffer.from('pk-lf-test:sk-lf-test').toString('base64'),
    )
    expect(headers['x-langfuse-ingestion-version']).toBe('4')
  })

  describe('resolveOTLPTracesEndpoint', () => {
    test('defaults to the EU Langfuse Cloud URL when nothing is set', () => {
      expect(resolveOTLPTracesEndpoint()).toBe(LANGFUSE_OTEL_DEFAULT_URL)
    })

    test('uses OTEL_EXPORTER_OTLP_TRACES_ENDPOINT verbatim', () => {
      process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] =
        'https://us.cloud.langfuse.com/api/public/otel/v1/traces'
      expect(resolveOTLPTracesEndpoint()).toBe(
        'https://us.cloud.langfuse.com/api/public/otel/v1/traces',
      )
    })

    test('appends /v1/traces to OTEL_EXPORTER_OTLP_ENDPOINT base URL', () => {
      // This is the footgun the change fixes: the base form of the URL must
      // have /v1/traces appended, or the exporter silently POSTs to the
      // wrong path.
      process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] =
        'https://us.cloud.langfuse.com/api/public/otel'
      expect(resolveOTLPTracesEndpoint()).toBe(
        'https://us.cloud.langfuse.com/api/public/otel/v1/traces',
      )
    })

    test('does not double-append /v1/traces when the base URL already has it', () => {
      process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] =
        'https://us.cloud.langfuse.com/api/public/otel/v1/traces'
      expect(resolveOTLPTracesEndpoint()).toBe(
        'https://us.cloud.langfuse.com/api/public/otel/v1/traces',
      )
    })

    test('strips a trailing slash before appending', () => {
      process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] =
        'https://us.cloud.langfuse.com/api/public/otel/'
      expect(resolveOTLPTracesEndpoint()).toBe(
        'https://us.cloud.langfuse.com/api/public/otel/v1/traces',
      )
    })

    test('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT takes precedence over OTEL_EXPORTER_OTLP_ENDPOINT', () => {
      process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] =
        'https://traces.example.com/v1/traces'
      process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'https://base.example.com'
      expect(resolveOTLPTracesEndpoint()).toBe('https://traces.example.com/v1/traces')
    })
  })

  test('OTEL_TRACES_EXPORTER=otlp without Langfuse creds throws a clear error', () => {
    process.env['OTEL_TRACES_EXPORTER'] = 'otlp'
    // No creds set, no OTEL_EXPORTER_OTLP_HEADERS either — must fail loud.
    expect(() => buildSpanProcessors()).toThrow(
      /LANGFUSE_PUBLIC_KEY|LANGFUSE_SECRET_KEY|OTEL_EXPORTER_OTLP_HEADERS/,
    )
  })

  test('otlp mode attaches BatchSpanProcessor for OTLP and SimpleSpanProcessor for file dual-write', () => {
    process.env['OTEL_TRACES_EXPORTER'] = 'otlp'
    process.env['LANGFUSE_PUBLIC_KEY'] = 'pk-lf-test'
    process.env['LANGFUSE_SECRET_KEY'] = 'sk-lf-test'
    const processors = buildSpanProcessors()
    expect(processors.length).toBe(2)
    // Order is load-bearing: OTLP (batched, remote) first, file (sync, local) second.
    expect(processors[0]).toBeInstanceOf(BatchSpanProcessor)
    expect(processors[1]).toBeInstanceOf(SimpleSpanProcessor)
  })

  test('non-otlp modes attach exactly one SimpleSpanProcessor', () => {
    // Default in NODE_ENV=test is the in-memory exporter.
    const processors = buildSpanProcessors()
    expect(processors.length).toBe(1)
    expect(processors[0]).toBeInstanceOf(SimpleSpanProcessor)
  })
})
