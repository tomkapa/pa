import Anthropic from '@anthropic-ai/sdk'

// Retriable server-side transient failures. 529 is Anthropic's "overloaded"
// status; the 5xx cluster covers brief gateway / proxy flakes. 4xx statuses
// (auth, invalid_request, request_too_large) are NOT retried — they won't
// succeed on retry and would just burn budget.
const RETRIABLE_STATUSES: ReadonlySet<number> = new Set([500, 502, 503, 504, 529])

/** Upper bound on our own retries *on top of* the SDK's built-in maxRetries. */
export const MAX_MODEL_RETRIES = 3

export function isRetriableModelError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return RETRIABLE_STATUSES.has(error.status)
  }
  return false
}

/**
 * Exponential backoff with ±25% jitter, capped so a single attempt never
 * sleeps absurdly long. Anthropic overload windows typically clear in
 * 30–120s, so a sequence of ~2s, ~4s, ~8s lines up well.
 */
export function computeBackoffMs(
  attempt: number,
  opts: { baseMs?: number; capMs?: number; random?: () => number } = {},
): number {
  const base = opts.baseMs ?? 2_000
  const cap = opts.capMs ?? 30_000
  const rand = opts.random ?? Math.random
  const exp = base * Math.pow(2, attempt)
  const jitter = 0.75 + rand() * 0.5
  return Math.min(Math.round(exp * jitter), cap)
}

/**
 * setTimeout-based sleep that honours an AbortSignal. Rejects with
 * AbortError if the signal fires, so callers can `try { await sleep }`
 * and bail out on user cancellation during backoff.
 */
export function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('aborted', 'AbortError'))
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
