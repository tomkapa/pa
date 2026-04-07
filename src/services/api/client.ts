import Anthropic from '@anthropic-ai/sdk'
import type { ClientOptions as AnthropicClientOptions } from '@anthropic-ai/sdk'
import { createDumpPromptsFetch } from '../observability/dumpPrompts.js'

export interface ClientOptions {
  apiKey?: string
  baseURL?: string
  maxRetries?: number
  timeoutMs?: number
}

const DEFAULT_MAX_RETRIES = 2
const DEFAULT_TIMEOUT_MS = 600_000

export function createAnthropicClient(options: ClientOptions = {}): Anthropic {
  const envTimeout = parseInt(process.env['API_TIMEOUT_MS'] ?? '', 10)
  const timeoutMs = options.timeoutMs ?? (Number.isFinite(envTimeout) ? envTimeout : DEFAULT_TIMEOUT_MS)

  return new Anthropic({
    apiKey: options.apiKey ?? process.env['ANTHROPIC_API_KEY'],
    baseURL: options.baseURL ?? process.env['ANTHROPIC_BASE_URL'],
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    timeout: timeoutMs,
    fetch: createDumpPromptsFetch() as AnthropicClientOptions['fetch'],
  })
}
