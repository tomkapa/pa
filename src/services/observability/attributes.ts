/**
 * Single source of truth for span attribute keys and related enum-like
 * constants used by the tracing module. Keeping these in one place:
 *
 *  - prevents typos from drifting between production code and tests
 *  - makes the rename to OTel GenAI semantic conventions auditable
 *  - documents which keys come from which spec / vendor
 *
 * Naming conventions:
 *  - `gen_ai.*`  — OpenTelemetry GenAI semantic conventions (experimental but
 *                  widely adopted; Langfuse, Phoenix and OpenLIT all parse
 *                  them for automatic token/cost attribution)
 *  - `langfuse.*` — Langfuse-specific, used to drive their Session view and
 *                   the Generation observation panel
 *  - `session.id` — OpenInference / Phoenix flavor of the session key; set
 *                   alongside `langfuse.session.id` so a single span works
 *                   in either backend
 *  - `pa.*`      — project-custom attributes that have no standard equivalent
 */

export const ATTR = {
  // OTel GenAI semantic conventions
  GEN_AI_SYSTEM: 'gen_ai.system',
  GEN_AI_OPERATION_NAME: 'gen_ai.operation.name',
  GEN_AI_REQUEST_MODEL: 'gen_ai.request.model',
  GEN_AI_RESPONSE_MODEL: 'gen_ai.response.model',
  GEN_AI_RESPONSE_ID: 'gen_ai.response.id',
  GEN_AI_RESPONSE_FINISH_REASONS: 'gen_ai.response.finish_reasons',
  GEN_AI_USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  GEN_AI_USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  // Anthropic/Langfuse vendor extension — not yet in the spec, but Langfuse
  // parses these as cached tokens for cost calculation.
  GEN_AI_USAGE_CACHE_READ: 'gen_ai.usage.cache_read_input_tokens',
  GEN_AI_USAGE_CACHE_CREATION: 'gen_ai.usage.cache_creation_input_tokens',
  GEN_AI_TOOL_NAME: 'gen_ai.tool.name',

  // Langfuse-specific
  LANGFUSE_SESSION_ID: 'langfuse.session.id',
  LANGFUSE_OBSERVATION_TYPE: 'langfuse.observation.type',
  // Langfuse reads these as the Input / Output panels in its UI. Per the
  // Langfuse OTel docs these are the preferred keys — also supports
  // `gen_ai.prompt` / `input.value` but the `langfuse.*` ones are
  // unambiguous. Values must be JSON strings (or plain strings for text).
  LANGFUSE_OBSERVATION_INPUT: 'langfuse.observation.input',
  LANGFUSE_OBSERVATION_OUTPUT: 'langfuse.observation.output',

  // OpenInference / Phoenix session id — harmless duplicate that lets the
  // same span land correctly in either backend.
  SESSION_ID: 'session.id',

  // Project-custom (non-standard, prefixed `pa.` to be honest about it)
  PA_TURN_NUMBER: 'pa.turn_number',
  PA_USER_INPUT_LENGTH: 'pa.user_input_length',
  PA_FINAL_TOKEN_COUNT: 'pa.final_token_count',
  PA_MESSAGES_COUNT: 'pa.gen_ai.request.messages.count',
  PA_TOOL_INPUT_SIZE: 'pa.tool.input_size',
  PA_TOOL_SUCCESS: 'pa.tool.success',
  PA_TOOL_OUTPUT_SIZE: 'pa.tool.output_size',
} as const

/** `gen_ai.system` value for Anthropic model calls. */
export const GEN_AI_SYSTEM_ANTHROPIC = 'anthropic'

/** `gen_ai.operation.name` value for chat/completion calls. */
export const OP_CHAT = 'chat'

/** `gen_ai.operation.name` value for tool invocations. */
export const OP_EXECUTE_TOOL = 'execute_tool'

/**
 * `langfuse.observation.type` value that unlocks the Langfuse "Generation"
 * panel (with token/cost breakdown and prompt inspector). Only applied to
 * LLM spans — the root interaction span is left untyped so Langfuse treats
 * it as the trace itself, which is the correct default.
 */
export const OBS_TYPE_GENERATION = 'generation'

/**
 * Default Langfuse Cloud OTLP endpoint (EU region). Users can override via
 * `OTEL_EXPORTER_OTLP_ENDPOINT` — e.g. US region:
 *   https://us.cloud.langfuse.com/api/public/otel/v1/traces
 */
export const LANGFUSE_OTEL_DEFAULT_URL =
  'https://cloud.langfuse.com/api/public/otel/v1/traces'
