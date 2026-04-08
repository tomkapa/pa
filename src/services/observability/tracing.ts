import { trace, type Attributes, type Span, type Tracer } from '@opentelemetry/api'
import {
  ConsoleSpanExporter,
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-node'
import { mkdirSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getObservabilityHome, getSessionId } from './state.js'

/**
 * OTel-backed session tracing for the agent. Each user turn opens an
 * `interaction` span; LLM calls and tool runs nest under it. Exporter is
 * selected at startup via `OTEL_TRACES_EXPORTER`:
 *
 * - `console` (dev default): print spans to stderr
 * - `file`: append JSON spans to `~/.pa/traces/<sessionId>.jsonl`
 * - `memory`: keep spans in memory (used by tests)
 * - `none`: drop spans entirely
 *
 * OTLP is intentionally **not** wired up by default — the optional dep can
 * be added later without changing call sites.
 */

const TRACER_NAME = 'pa.agent'

type ExporterChoice = 'console' | 'file' | 'memory' | 'none'

let provider: NodeTracerProvider | null = null
let tracer: Tracer | null = null
let turnCounter = 0
let inMemoryExporter: InMemorySpanExporter | null = null

class FileSpanExporter implements SpanExporter {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: number; error?: Error }) => void,
  ): void {
    const lines = spans.map(s => JSON.stringify(spanToJson(s))).join('\n') + '\n'
    appendFile(this.filePath, lines)
      .then(() => resultCallback({ code: 0 }))
      .catch((error: Error) => resultCallback({ code: 1, error }))
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

class NoopSpanExporter implements SpanExporter {
  export(_spans: ReadableSpan[], cb: (r: { code: number }) => void): void {
    cb({ code: 0 })
  }
  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

function spanToJson(span: ReadableSpan): Record<string, unknown> {
  return {
    name: span.name,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId ?? null,
    startTime: span.startTime,
    endTime: span.endTime,
    duration: span.duration,
    attributes: span.attributes,
    status: span.status,
  }
}

function pickExporter(): SpanExporter {
  const raw = (process.env['OTEL_TRACES_EXPORTER'] ?? '').toLowerCase()
  // Test mode: default to in-memory so we never spam the test runner. Tests
  // assert via `__getCollectedSpansForTests()`.
  const isTest = process.env['NODE_ENV'] === 'test'
  const choice: ExporterChoice = (() => {
    if (raw === 'file' || raw === 'memory' || raw === 'none' || raw === 'console') return raw
    return isTest ? 'memory' : 'file'
  })()

  switch (choice) {
    case 'file': {
      const dir = join(getObservabilityHome(), 'traces')
      mkdirSync(dir, { recursive: true })
      return new FileSpanExporter(join(dir, `${getSessionId()}.jsonl`))
    }
    case 'memory':
      inMemoryExporter = new InMemorySpanExporter()
      return inMemoryExporter
    case 'none':
      return new NoopSpanExporter()
    case 'console':
      return new ConsoleSpanExporter()
  }
}

function ensureTracer(): Tracer {
  if (tracer) return tracer
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(pickExporter())],
  })
  provider.register()
  tracer = trace.getTracer(TRACER_NAME)
  return tracer
}

/**
 * Estimate the byte size of a tool input/output without serializing the whole
 * structure. `Edit`/`Write`/`Read` payloads can be megabytes — a full
 * `JSON.stringify` per span is unaffordable.
 */
function estimateSize(value: unknown): number {
  if (value == null) return 0
  if (typeof value === 'string') return value.length
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length
  if (Array.isArray(value)) {
    let n = 2
    for (const v of value) n += estimateSize(v) + 1
    return n
  }
  if (typeof value === 'object') {
    let n = 2
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      n += k.length + 3 + estimateSize(v) + 1
    }
    return n
  }
  return 0
}

export interface InteractionUsage {
  finalTokenCount?: number
}

export interface LLMResponseUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  stopReason?: string | null
  requestId?: string
}

export interface ToolResultUsage {
  success: boolean
  outputSize?: number
}

/**
 * Open an `interaction` span (one per user turn). Caller is responsible for
 * passing the returned span back to `endInteractionSpan` from a `finally`
 * block so it always closes.
 */
export function startInteractionSpan(userInput: string): Span {
  const t = ensureTracer()
  turnCounter += 1
  const attrs: Attributes = {
    session_id: getSessionId(),
    turn_number: turnCounter,
    user_input_length: userInput.length,
  }
  return t.startSpan('interaction', { attributes: attrs })
}

export function endInteractionSpan(span: Span, usage: InteractionUsage = {}): void {
  if (usage.finalTokenCount !== undefined) {
    span.setAttribute('final_token_count', usage.finalTokenCount)
  }
  span.end()
}

/** Open an `llm_request` child span. */
export function startLLMRequestSpan(model: string, messageCount: number): Span {
  const t = ensureTracer()
  const attrs: Attributes = { model, message_count: messageCount }
  return t.startSpan('llm_request', { attributes: attrs })
}

export function endLLMRequestSpan(span: Span, usage: LLMResponseUsage = {}): void {
  if (usage.inputTokens !== undefined) span.setAttribute('input_tokens', usage.inputTokens)
  if (usage.outputTokens !== undefined) span.setAttribute('output_tokens', usage.outputTokens)
  if (usage.cacheReadTokens !== undefined) span.setAttribute('cache_read_tokens', usage.cacheReadTokens)
  if (usage.cacheCreationTokens !== undefined)
    span.setAttribute('cache_creation_tokens', usage.cacheCreationTokens)
  if (usage.stopReason != null) span.setAttribute('stop_reason', usage.stopReason)
  if (usage.requestId) span.setAttribute('request_id', usage.requestId)
  span.end()
}

/** Open a `tool` child span. */
export function startToolSpan(toolName: string, input: unknown): Span {
  const t = ensureTracer()
  const attrs: Attributes = { tool_name: toolName, input_size: estimateSize(input) }
  return t.startSpan('tool', { attributes: attrs })
}

export function endToolSpan(span: Span, result: ToolResultUsage): void {
  span.setAttribute('success', result.success)
  if (result.outputSize !== undefined) span.setAttribute('output_size', result.outputSize)
  span.end()
}

/** Force-flush any buffered spans. Mostly a test helper. */
export async function flushTracer(): Promise<void> {
  if (provider) {
    try {
      await provider.forceFlush()
    } catch {
      // ignore
    }
  }
}

/** Test-only: read spans collected by the in-memory exporter. */
export function __getCollectedSpansForTests(): ReadableSpan[] {
  return inMemoryExporter?.getFinishedSpans() ?? []
}

/**
 * Test-only: tear down provider and clear in-memory state so the next call
 * to a tracing helper re-initializes against the current env vars.
 */
export function __resetTracerForTests(): void {
  if (inMemoryExporter) {
    inMemoryExporter.reset()
    inMemoryExporter = null
  }
  if (provider) {
    void provider.shutdown().catch(() => {})
    provider = null
  }
  tracer = null
  turnCounter = 0
  trace.disable()
}
