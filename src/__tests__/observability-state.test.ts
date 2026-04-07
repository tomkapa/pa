import { describe, test, expect } from 'bun:test'
import { getSessionId } from '../services/observability/state.js'

describe('observability/state', () => {
  test('getSessionId returns a stable, non-empty UUID for the process lifetime', () => {
    const a = getSessionId()
    const b = getSessionId()
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})
