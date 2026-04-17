import { describe, test, expect } from 'bun:test'
import Anthropic from '@anthropic-ai/sdk'
import {
  MAX_MODEL_RETRIES,
  computeBackoffMs,
  isRetriableModelError,
  sleepWithAbort,
} from '../services/agent/retry.js'

function makeAPIError(status: number): Anthropic.APIError {
  return new Anthropic.APIError(
    status,
    { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } },
    'overloaded',
    new Headers(),
  )
}

describe('isRetriableModelError', () => {
  test('retries 529 (overloaded)', () => {
    expect(isRetriableModelError(makeAPIError(529))).toBe(true)
  })

  test('retries 5xx', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(isRetriableModelError(makeAPIError(status))).toBe(true)
    }
  })

  test('does NOT retry client errors', () => {
    for (const status of [400, 401, 403, 404, 413, 429]) {
      expect(isRetriableModelError(makeAPIError(status))).toBe(false)
    }
  })

  test('does NOT retry non-APIError objects', () => {
    expect(isRetriableModelError(new Error('something'))).toBe(false)
    expect(isRetriableModelError('string')).toBe(false)
    expect(isRetriableModelError(null)).toBe(false)
  })
})

describe('computeBackoffMs', () => {
  test('grows exponentially with attempt', () => {
    const random = () => 0.5 // jitter factor = 1.0 (middle of ±25%)
    expect(computeBackoffMs(0, { random })).toBe(2_000)
    expect(computeBackoffMs(1, { random })).toBe(4_000)
    expect(computeBackoffMs(2, { random })).toBe(8_000)
    expect(computeBackoffMs(3, { random })).toBe(16_000)
  })

  test('caps at opts.capMs', () => {
    expect(computeBackoffMs(20, { random: () => 0.5, capMs: 30_000 })).toBe(30_000)
  })

  test('applies ±25% jitter', () => {
    const low = computeBackoffMs(0, { random: () => 0 })
    const high = computeBackoffMs(0, { random: () => 1 })
    expect(low).toBe(1_500) // 2000 * 0.75
    expect(high).toBe(2_500) // 2000 * 1.25
  })

  test('MAX_MODEL_RETRIES is a finite positive number', () => {
    expect(MAX_MODEL_RETRIES).toBeGreaterThan(0)
    expect(Number.isFinite(MAX_MODEL_RETRIES)).toBe(true)
  })
})

describe('sleepWithAbort', () => {
  test('resolves after the timeout', async () => {
    const start = Date.now()
    await sleepWithAbort(40)
    expect(Date.now() - start).toBeGreaterThanOrEqual(35)
  })

  test('rejects with AbortError when the signal fires during sleep', async () => {
    const controller = new AbortController()
    const sleep = sleepWithAbort(10_000, controller.signal)
    setTimeout(() => controller.abort(), 20)
    await expect(sleep).rejects.toThrow('aborted')
  })

  test('rejects immediately when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(sleepWithAbort(1_000, controller.signal)).rejects.toThrow('aborted')
  })
})
