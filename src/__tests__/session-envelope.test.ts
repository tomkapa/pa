import { describe, test, expect, beforeEach } from 'bun:test'
import type { UserMessage } from '../types/message.js'

const MODULE_PATH = '../services/session/envelope.js'

function makeUser(text: string, uuid: string = crypto.randomUUID()): UserMessage {
  return {
    type: 'user',
    uuid,
    timestamp: '2026-04-08T10:00:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text }] },
  }
}

describe('session envelope', () => {
  beforeEach(async () => {
    const { clearGitBranchCache } = await import(MODULE_PATH)
    clearGitBranchCache()
  })

  test('wrapMessage adds envelope metadata', async () => {
    const { wrapMessage, SESSION_SCHEMA_VERSION } = await import(MODULE_PATH)
    const msg = makeUser('hello')
    const wrapped = wrapMessage(msg, {
      sessionId: 'sess-1',
      cwd: '/tmp/x',
      gitBranch: 'main',
    }, null)

    expect(wrapped.type).toBe('user')
    expect(wrapped.uuid).toBe(msg.uuid)
    expect(wrapped.sessionId).toBe('sess-1')
    expect(wrapped.cwd).toBe('/tmp/x')
    expect(wrapped.gitBranch).toBe('main')
    expect(wrapped.version).toBe(SESSION_SCHEMA_VERSION)
    expect(wrapped.parentUuid).toBeNull()
    expect(wrapped.timestamp).toBe(msg.timestamp)
  })

  test('wrapMessage omits gitBranch when not provided', async () => {
    const { wrapMessage } = await import(MODULE_PATH)
    const msg = makeUser('hi')
    const wrapped = wrapMessage(msg, { sessionId: 's', cwd: '/tmp' }, null)
    expect(wrapped.gitBranch).toBeUndefined()
  })

  test('wrapMessage accepts a parentUuid to chain entries', async () => {
    const { wrapMessage } = await import(MODULE_PATH)
    const first = makeUser('a', 'uuid-a')
    const second = makeUser('b', 'uuid-b')
    const w1 = wrapMessage(first, { sessionId: 's', cwd: '/tmp' }, null)
    const w2 = wrapMessage(second, { sessionId: 's', cwd: '/tmp' }, w1.uuid)
    expect(w1.parentUuid).toBeNull()
    expect(w2.parentUuid).toBe('uuid-a')
  })

  test('unwrapMessage round-trips back to a plain Message', async () => {
    const { wrapMessage, unwrapMessage } = await import(MODULE_PATH)
    const msg = makeUser('round trip')
    const wrapped = wrapMessage(msg, { sessionId: 's', cwd: '/tmp' }, null)
    const unwrapped = unwrapMessage(wrapped)

    expect(unwrapped).toEqual(msg)
    // Envelope fields must NOT leak into the unwrapped message.
    expect((unwrapped as Record<string, unknown>).sessionId).toBeUndefined()
    expect((unwrapped as Record<string, unknown>).cwd).toBeUndefined()
    expect((unwrapped as Record<string, unknown>).parentUuid).toBeUndefined()
    expect((unwrapped as Record<string, unknown>).version).toBeUndefined()
  })

  test('getGitBranch caches per cwd', async () => {
    const { getGitBranch } = await import(MODULE_PATH)
    // Call twice; second should hit the cache. We can't assert the branch
    // value (depends on the test machine) but we can assert stability.
    const a = getGitBranch('/tmp')
    const b = getGitBranch('/tmp')
    expect(a).toBe(b)
  })
})
