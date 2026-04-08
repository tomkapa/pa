import {
  context,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
  type Tracer,
} from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-node'
import { mkdirSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ATTR,
  GEN_AI_SYSTEM_ANTHROPIC,
  LANGFUSE_OTEL_DEFAULT_URL,
  OBS_TYPE_GENERATION,
  OP_CHAT,
  OP_EXECUTE_TOOL,
} from './attributes.js'
import { logForDebugging } from './debug.js'
import { getObservabilityHome, getSessionId } from './state.js'

/**
 * OTel-backed session tracing for the agent. Each user turn opens an
 * `interaction` span; LLM calls and tool runs nest under it. Exporter is
 * selected at startup via `OTEL_TRACES_EXPORTER`:
 *
 *  - `console` — print spans to stderr
 *  - `file`    — append JSON spans to `~/.pa/traces/<sessionId>.jsonl` (dev default)
 *  - `memory`  — keep spans in memory (test default)
 *  - `none`    — drop spans entirely
 *  - `otlp`    — ship spans to an OTLP/HTTP collector AND dual-write JSONL
 *                locally so forensic replay keeps working even if the remote
 *                endpoint is down. Primary target is Langfuse Cloud.
 *
 * OTLP env var contract (`otlp` mode only), resolved in this order:
 *  - `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` — full URL, used verbatim
 *  - `OTEL_EXPORTER_OTLP_ENDPOINT`        — base URL, `/v1/traces` appended
 *                                           per OTel spec
 *  - default: EU Langfuse Cloud (`LANGFUSE_OTEL_DEFAULT_URL`)
 *
 * Authentication:
 *  - `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` auto-construct
 *    `Authorization: Basic base64(pk:sk)` + the
 *    `x-langfuse-ingestion-version: 4` header that unlocks real-time display
 *    in Langfuse Cloud Fast Preview.
 *  - `OTEL_EXPORTER_OTLP_HEADERS` is respected as an advanced escape hatch
 *    when Langfuse creds are absent.
 *
 * OTLP uses a `BatchSpanProcessor` (HTTP is too slow for `SimpleSpanProcessor`);
 * a shutdown handler force-flushes spans on SIGINT/SIGTERM/beforeExit with a
 * 2-second timeout so a hung endpoint cannot deadlock CLI exit. Export
 * results are logged via `logForDebugging` so `PA_DEBUG=1` surfaces Langfuse
 * 4xx/network errors that would otherwise be swallowed by the SDK.
 */

const TRACER_NAME = 'pa.agent'
const SHUTDOWN_TIMEOUT_MS = 2_000

type ExporterChoice = 'console' | 'file' | 'memory' | 'none' | 'otlp'

let provider: NodeTracerProvider | null = null
let tracer: Tracer | null = null
let turnCounter = 0
let inMemoryExporter: InMemorySpanExporter | null = null
let shutdownHandlersInstalled = false

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

/**
 * Wraps a `SpanExporter` and logs export results via `logForDebugging`.
 * The `BatchSpanProcessor` swallows OTLP export errors by design so the
 * agent loop stays fast, but that leaves users with zero visibility into
 * Langfuse 4xx responses, auth failures, or network drops. This adapter
 * surfaces them to the debug log without touching the hot path.
 */
class DebugLoggingSpanExporter implements SpanExporter {
  constructor(
    private readonly inner: SpanExporter,
    private readonly label: string,
  ) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: number; error?: Error }) => void,
  ): void {
    this.inner.export(spans, result => {
      if (result.code === 0) {
        logForDebugging(`${this.label}: exported ${spans.length} spans`, {
          level: 'info',
        })
      } else {
        const reason = result.error?.message ?? 'unknown error'
        logForDebugging(
          `${this.label}: export FAILED for ${spans.length} spans: ${reason}`,
          { level: 'error' },
        )
      }
      resultCallback(result)
    })
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown()
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve()
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

function resolveExporterChoice(): ExporterChoice {
  const raw = (process.env['OTEL_TRACES_EXPORTER'] ?? '').toLowerCase()
  if (
    raw === 'file' ||
    raw === 'memory' ||
    raw === 'none' ||
    raw === 'console' ||
    raw === 'otlp'
  ) {
    return raw
  }
  // Test mode: default to in-memory so we never spam the test runner.
  // Tests assert via `__getCollectedSpansForTests()`.
  return process.env['NODE_ENV'] === 'test' ? 'memory' : 'file'
}

function createFileExporter(): FileSpanExporter {
  const dir = join(getObservabilityHome(), 'traces')
  mkdirSync(dir, { recursive: true })
  return new FileSpanExporter(join(dir, `${getSessionId()}.jsonl`))
}

/**
 * Build the `Authorization: Basic` header value for Langfuse Cloud's OTLP
 * ingest. Exported (and kept pure) so tests can lock the encoding in place
 * without introspecting the exporter's private state.
 */
export function buildLangfuseAuthHeader(publicKey: string, secretKey: string): string {
  const encoded = Buffer.from(`${publicKey}:${secretKey}`).toString('base64')
  return `Basic ${encoded}`
}

/**
 * Resolve the OTLP traces endpoint URL per the OpenTelemetry env var spec:
 *
 *  1. `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is used verbatim (full URL).
 *  2. `OTEL_EXPORTER_OTLP_ENDPOINT` is treated as a base URL and has
 *     `/v1/traces` appended — mirrors what the OTel SDK does internally
 *     when no `url` is passed explicitly to the exporter.
 *  3. Fall back to the EU Langfuse Cloud default.
 *
 * Exported for direct unit testing. The explicit resolution matters because
 * `OTLPTraceExporter` does NOT auto-append `/v1/traces` when you pass a
 * `url` in its constructor — doing that ourselves closes a footgun where
 * `OTEL_EXPORTER_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel`
 * would silently POST to the wrong path.
 */
export function resolveOTLPTracesEndpoint(): string {
  const tracesEndpoint = process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']
  if (tracesEndpoint && tracesEndpoint.length > 0) return tracesEndpoint

  const baseEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
  if (baseEndpoint && baseEndpoint.length > 0) {
    const trimmed = baseEndpoint.replace(/\/+$/, '')
    // Idempotent: don't double-append if the user already included the path.
    return trimmed.endsWith('/v1/traces') ? trimmed : `${trimmed}/v1/traces`
  }

  return LANGFUSE_OTEL_DEFAULT_URL
}

/**
 * Build the header map for Langfuse Cloud OTLP ingest.
 *  - `Authorization: Basic <...>`  — HTTP basic auth
 *  - `x-langfuse-ingestion-version: 4` — per Langfuse docs, required for
 *    real-time display in Langfuse Cloud Fast Preview. Without it, spans
 *    may be ingested on a slower path and not appear promptly in the UI.
 *
 * Exported so tests can lock the exact header set.
 */
export function buildLangfuseHeaders(
  publicKey: string,
  secretKey: string,
): Record<string, string> {
  return {
    Authorization: buildLangfuseAuthHeader(publicKey, secretKey),
    'x-langfuse-ingestion-version': '4',
  }
}

/**
 * Construct the OTLP/HTTP exporter. Fails loud on misconfiguration — per
 * CLAUDE.md we do not swallow errors or silently fall back to file export.
 * A user who typed `OTEL_TRACES_EXPORTER=otlp` wants OTLP; if we can't
 * satisfy that, surface the reason immediately.
 */
function buildOTLPExporter(): OTLPTraceExporter {
  const url = resolveOTLPTracesEndpoint()

  const publicKey = process.env['LANGFUSE_PUBLIC_KEY']
  const secretKey = process.env['LANGFUSE_SECRET_KEY']
  const rawHeaders = process.env['OTEL_EXPORTER_OTLP_HEADERS']

  if (publicKey && secretKey) {
    return new OTLPTraceExporter({
      url,
      headers: buildLangfuseHeaders(publicKey, secretKey),
    })
  }

  if (rawHeaders && rawHeaders.length > 0) {
    // Defer to the SDK's parser for OTEL_EXPORTER_OTLP_HEADERS.
    return new OTLPTraceExporter({ url })
  }

  throw new Error(
    'OTEL_TRACES_EXPORTER=otlp requires authentication: set LANGFUSE_PUBLIC_KEY and ' +
    'LANGFUSE_SECRET_KEY (recommended) or pass OTEL_EXPORTER_OTLP_HEADERS directly. ' +
    `Endpoint: ${url}`,
  )
}

/**
 * Build the span processor chain for the active exporter choice. Exported
 * so tests can verify the wiring as a pure function without spinning up the
 * full `NodeTracerProvider`.
 *
 * Dual-write semantics: in `otlp` mode we attach BOTH a BatchSpanProcessor
 * (remote, Langfuse) AND a SimpleSpanProcessor (local JSONL forensics) so a
 * Langfuse outage cannot take down local debugging.
 */
export function buildSpanProcessors(): SpanProcessor[] {
  const choice = resolveExporterChoice()
  switch (choice) {
    case 'otlp': {
      // Wrap the raw OTLP exporter so successes/failures show up in
      // ~/.pa/debug/<sessionId>.txt when PA_DEBUG=1. Without this the
      // BatchSpanProcessor swallows Langfuse 4xx / network errors, leaving
      // the user with no way to see why traces aren't landing.
      const otlp = new DebugLoggingSpanExporter(buildOTLPExporter(), 'otlp')
      const file = createFileExporter()
      return [new BatchSpanProcessor(otlp), new SimpleSpanProcessor(file)]
    }
    case 'file':
      return [new SimpleSpanProcessor(createFileExporter())]
    case 'memory': {
      inMemoryExporter = new InMemorySpanExporter()
      return [new SimpleSpanProcessor(inMemoryExporter)]
    }
    case 'none':
      return [new SimpleSpanProcessor(new NoopSpanExporter())]
    case 'console':
      return [new SimpleSpanProcessor(new ConsoleSpanExporter())]
  }
}

/**
 * Install shutdown handlers that force-flush buffered spans before the
 * process exits. Required when using `BatchSpanProcessor` (OTLP path) — the
 * default 5s batch schedule will lose the last few spans on abrupt exit.
 *
 * A 2-second `Promise.race` timeout guards against a hung Langfuse endpoint
 * deadlocking CLI exit. Signals are re-emitted after shutdown so the runtime
 * actually terminates. `'exit'` is intentionally NOT hooked because it is
 * sync-only and cannot await a Promise. Idempotent: safe to call multiple
 * times from `ensureTracer`.
 */
function installShutdownHandlers(tracerProvider: NodeTracerProvider): void {
  if (shutdownHandlersInstalled) return
  shutdownHandlersInstalled = true

  const shutdownWithTimeout = async (): Promise<void> => {
    const timeout = new Promise<void>(resolve => {
      const t = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)
      t.unref()
    })
    try {
      await Promise.race([tracerProvider.shutdown(), timeout])
    } catch {
      // Swallowing is correct *here*: shutdown is best-effort on exit and we
      // must never let a tracer error block CLI termination.
    }
  }

  const onSignal = (signal: NodeJS.Signals): void => {
    void shutdownWithTimeout().then(() => {
      // Re-raise the original signal so the process actually dies; replacing
      // the handler first prevents an infinite loop.
      process.removeListener(signal, onSignal)
      process.kill(process.pid, signal)
    })
  }

  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  process.on('beforeExit', () => {
    void shutdownWithTimeout()
  })
  process.on('uncaughtException', () => {
    void shutdownWithTimeout()
  })
}

function ensureTracer(): Tracer {
  if (tracer) return tracer
  provider = new NodeTracerProvider({ spanProcessors: buildSpanProcessors() })
  provider.register()
  installShutdownHandlers(provider)
  tracer = trace.getTracer(TRACER_NAME)
  return tracer
}

/**
 * Upper bound on a single `langfuse.observation.input|output` attribute
 * value. Real tool outputs (`Read`, `Bash` on large files) can be many MB;
 * we'd blow up the OTLP batch payload and get throttled by Langfuse for
 * zero debugging upside. 32 KiB is enough to see the full prompt of a
 * typical LLM turn or the first screen of a tool result, which is what
 * debugging actually needs.
 */
const MAX_OBSERVATION_BYTES = 32 * 1024

function truncateString(text: string): string {
  return `${text.slice(0, MAX_OBSERVATION_BYTES)}…[truncated, original ${text.length} bytes]`
}

/**
 * Serialize a value for a `langfuse.observation.input|output` attribute.
 * Strings pass through unchanged (so a text prompt stays readable in the
 * Langfuse UI); everything else is `JSON.stringify`'d.
 *
 * For non-strings we pre-measure with `estimateSize` — a cheap tree walk
 * that avoids materializing any intermediate strings. If the rough size
 * blows past `MAX_OBSERVATION_BYTES` with headroom for JSON overhead, we
 * skip the stringify entirely and emit a placeholder. This matters because
 * tool inputs/outputs can be many megabytes (`Read` on a large file,
 * `Bash` on a log dump); without the precheck we'd allocate the full
 * serialized string just to throw 99% of it away, and OTLP batches would
 * balloon enough to trip Langfuse's payload limits.
 */
function serializeObservationValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.length <= MAX_OBSERVATION_BYTES ? value : truncateString(value)
  }
  // 2x slack allows for JSON overhead (quotes, braces, commas, escaped
  // characters) without having to count exactly. estimateSize slightly
  // under-reports nested structures, so the buffer is deliberately generous.
  if (estimateSize(value) > MAX_OBSERVATION_BYTES * 2) {
    return `[large payload omitted, ~${estimateSize(value)} bytes]`
  }
  let text: string
  try {
    text = JSON.stringify(value) ?? 'null'
  } catch {
    // Circular refs, BigInt, etc. — degrade gracefully so instrumentation
    // cannot crash the caller.
    return String(value)
  }
  return text.length <= MAX_OBSERVATION_BYTES ? text : truncateString(text)
}

function setObservationInput(span: Span, value: unknown): void {
  span.setAttribute(ATTR.LANGFUSE_OBSERVATION_INPUT, serializeObservationValue(value))
}

function setObservationOutput(span: Span, value: unknown): void {
  span.setAttribute(ATTR.LANGFUSE_OBSERVATION_OUTPUT, serializeObservationValue(value))
}

/**
 * Build a child context anchored to the given parent span, or fall through
 * to the current active context if no parent was provided. This is the
 * piece that was missing in the first version of the tracer — without it,
 * every `startSpan` call ignored the `interactionSpan` the caller held and
 * produced a fresh root trace, which is why Langfuse showed a flat list of
 * disconnected spans instead of a nested waterfall.
 */
function childContext(parent?: Span): Context {
  return parent ? trace.setSpan(context.active(), parent) : context.active()
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
  /** Final assistant output for display in Langfuse's Output panel. */
  output?: unknown
}

export interface LLMRequestParams {
  model: string
  messageCount: number
  /**
   * Parent span — almost always the active `interaction` span. Required for
   * Langfuse/Jaeger to render nested waterfalls instead of a flat list of
   * disconnected root spans.
   */
  parent?: Span
  /** Full messages array sent to the model; rendered in Langfuse's Input panel. */
  input?: unknown
}

export interface LLMResponseUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  stopReason?: string | null
  requestId?: string
  /** Assistant response content blocks; rendered in Langfuse's Output panel. */
  output?: unknown
}

export interface ToolSpanParams {
  toolName: string
  input: unknown
  /**
   * Parent span — almost always the active `interaction` span. Without it
   * the tool span becomes a disconnected root and Langfuse renders a flat
   * list instead of a nested waterfall.
   */
  parent?: Span
}

export interface ToolResultUsage {
  success: boolean
  outputSize?: number
  /** Tool result content; rendered in Langfuse's Output panel. */
  output?: unknown
}

/**
 * Open an `interaction` span (one per user turn). Caller is responsible for
 * passing the returned span back to `endInteractionSpan` from a `finally`
 * block so it always closes.
 */
export function startInteractionSpan(userInput: string): Span {
  const t = ensureTracer()
  turnCounter += 1
  const sessionId = getSessionId()
  const attrs: Attributes = {
    // Set both session keys so a single span works in either Langfuse
    // (langfuse.session.id) or OpenInference/Phoenix (session.id).
    [ATTR.LANGFUSE_SESSION_ID]: sessionId,
    [ATTR.SESSION_ID]: sessionId,
    [ATTR.PA_TURN_NUMBER]: turnCounter,
    [ATTR.PA_USER_INPUT_LENGTH]: userInput.length,
    // Feed the user's raw prompt into Langfuse's Input panel. Plain string
    // (no JSON wrapper) so it stays readable in the UI.
    [ATTR.LANGFUSE_OBSERVATION_INPUT]: serializeObservationValue(userInput),
  }
  return t.startSpan('interaction', { attributes: attrs })
}

export function endInteractionSpan(span: Span, usage: InteractionUsage = {}): void {
  if (usage.finalTokenCount !== undefined) {
    span.setAttribute(ATTR.PA_FINAL_TOKEN_COUNT, usage.finalTokenCount)
  }
  if (usage.output !== undefined) {
    setObservationOutput(span, usage.output)
  }
  span.end()
}

/**
 * Open an LLM request span. Uses the GenAI semantic convention name
 * `chat <model>` so Langfuse's UI renders it cleanly as a Generation.
 *
 * Pass the active `interaction` span as `params.parent` so the generation
 * nests correctly under the turn in Langfuse's trace waterfall. Pass the
 * full `messages` array as `params.input` to populate the Input panel.
 */
export function startLLMRequestSpan(params: LLMRequestParams): Span {
  const t = ensureTracer()
  const attrs: Attributes = {
    [ATTR.GEN_AI_SYSTEM]: GEN_AI_SYSTEM_ANTHROPIC,
    [ATTR.GEN_AI_OPERATION_NAME]: OP_CHAT,
    [ATTR.GEN_AI_REQUEST_MODEL]: params.model,
    // Unlocks Langfuse's Generation panel (token + cost breakdown,
    // prompt inspector). Safe no-op on other backends.
    [ATTR.LANGFUSE_OBSERVATION_TYPE]: OBS_TYPE_GENERATION,
    [ATTR.PA_MESSAGES_COUNT]: params.messageCount,
  }
  if (params.input !== undefined) {
    attrs[ATTR.LANGFUSE_OBSERVATION_INPUT] = serializeObservationValue(params.input)
  }
  return t.startSpan(
    `${OP_CHAT} ${params.model}`,
    { attributes: attrs },
    childContext(params.parent),
  )
}

export function endLLMRequestSpan(span: Span, usage: LLMResponseUsage = {}): void {
  if (usage.inputTokens !== undefined) {
    span.setAttribute(ATTR.GEN_AI_USAGE_INPUT_TOKENS, usage.inputTokens)
  }
  if (usage.outputTokens !== undefined) {
    span.setAttribute(ATTR.GEN_AI_USAGE_OUTPUT_TOKENS, usage.outputTokens)
  }
  if (usage.cacheReadTokens !== undefined) {
    span.setAttribute(ATTR.GEN_AI_USAGE_CACHE_READ, usage.cacheReadTokens)
  }
  if (usage.cacheCreationTokens !== undefined) {
    span.setAttribute(ATTR.GEN_AI_USAGE_CACHE_CREATION, usage.cacheCreationTokens)
  }
  if (usage.stopReason != null) {
    // Per spec, `gen_ai.response.finish_reasons` is an array of strings even
    // when only one reason is reported.
    span.setAttribute(ATTR.GEN_AI_RESPONSE_FINISH_REASONS, [usage.stopReason])
  }
  if (usage.requestId) {
    span.setAttribute(ATTR.GEN_AI_RESPONSE_ID, usage.requestId)
  }
  if (usage.output !== undefined) {
    setObservationOutput(span, usage.output)
  }
  span.end()
}

/**
 * Open a tool execution span. Span name follows the GenAI agent-spans
 * convention `execute_tool <tool_name>` so Langfuse's trace waterfall is
 * immediately readable.
 */
export function startToolSpan(params: ToolSpanParams): Span {
  const t = ensureTracer()
  const attrs: Attributes = {
    [ATTR.GEN_AI_OPERATION_NAME]: OP_EXECUTE_TOOL,
    [ATTR.GEN_AI_TOOL_NAME]: params.toolName,
    [ATTR.PA_TOOL_INPUT_SIZE]: estimateSize(params.input),
    [ATTR.LANGFUSE_OBSERVATION_INPUT]: serializeObservationValue(params.input),
  }
  return t.startSpan(
    `${OP_EXECUTE_TOOL} ${params.toolName}`,
    { attributes: attrs },
    childContext(params.parent),
  )
}

export function endToolSpan(span: Span, result: ToolResultUsage): void {
  span.setAttribute(ATTR.PA_TOOL_SUCCESS, result.success)
  // Derive output size from `output` when an explicit value isn't given,
  // so callers only have to supply the payload once.
  const outputSize =
    result.outputSize ??
    (result.output !== undefined ? estimateSize(result.output) : undefined)
  if (outputSize !== undefined) {
    span.setAttribute(ATTR.PA_TOOL_OUTPUT_SIZE, outputSize)
  }
  if (result.output !== undefined) {
    setObservationOutput(span, result.output)
  }
  if (!result.success) {
    // Propagate failure to the span status so backends (Langfuse, Jaeger)
    // render errored tool calls in red — per CLAUDE.md, don't swallow.
    span.setStatus({ code: SpanStatusCode.ERROR })
  }
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
    void provider.shutdown().catch(() => { })
    provider = null
  }
  tracer = null
  turnCounter = 0
  trace.disable()
}
