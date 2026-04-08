import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { UserMessage, AssistantMessage } from '../types/message.js'
import { createSessionWriter } from '../services/session/writer.js'
import { loadSession } from '../services/session/reader.js'

function makeUser(text: string): UserMessage {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: [{ type: 'text', text }] },
  }
}

function makeAssistant(text: string): AssistantMessage {
  return {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: 'req_test',
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text, citations: null }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      stop_details: null,
      container: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation: null,
        inference_geo: null,
        server_tool_use: null,
        service_tier: null,
      },
    },
  }
}

describe('SessionWriter + SessionReader', () => {
  let tmp: string
  let filePath: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'pa-session-wr-'))
    filePath = path.join(tmp, 'nested', 'dir', 'sess.jsonl')
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('writes and reads back a single message', async () => {
    const writer = createSessionWriter({
      filePath,
      context: { sessionId: 's1', cwd: '/tmp/test' },
      drainIntervalMs: 0,
    })
    const msg = makeUser('hello')
    writer.append(msg)
    await writer.close()

    const loaded = await loadSession(filePath)
    expect(loaded).not.toBeNull()
    expect(loaded!).toHaveLength(1)
    expect(loaded![0]!.uuid).toBe(msg.uuid)
    expect(loaded![0]!.type).toBe('user')
  })

  test('preserves order across multiple appends', async () => {
    const writer = createSessionWriter({
      filePath,
      context: { sessionId: 's1', cwd: '/tmp/test' },
      drainIntervalMs: 0,
    })
    const u = makeUser('first')
    const a = makeAssistant('reply')
    const u2 = makeUser('second')
    writer.append(u)
    writer.append(a)
    writer.append(u2)
    await writer.close()

    const loaded = await loadSession(filePath)
    expect(loaded!.map(m => m.uuid)).toEqual([u.uuid, a.uuid, u2.uuid])
    expect(loaded!.map(m => m.type)).toEqual(['user', 'assistant', 'user'])
  })

  test('close is idempotent and append after close is a no-op', async () => {
    const writer = createSessionWriter({
      filePath,
      context: { sessionId: 's1', cwd: '/tmp/test' },
      drainIntervalMs: 0,
    })
    writer.append(makeUser('before close'))
    await writer.close()
    await writer.close() // double-close
    writer.append(makeUser('after close')) // no-op

    const loaded = await loadSession(filePath)
    expect(loaded!).toHaveLength(1)
  })

  test('lazy file creation — nothing on disk until first append', async () => {
    const writer = createSessionWriter({
      filePath,
      context: { sessionId: 's1', cwd: '/tmp/test' },
      drainIntervalMs: 0,
    })
    await writer.close()
    // File should not exist — close without append leaves nothing behind.
    expect(await loadSession(filePath)).toBeNull()
  })

  test('reader returns null for missing file', async () => {
    const result = await loadSession(path.join(tmp, 'nope.jsonl'))
    expect(result).toBeNull()
  })

  test('reader silently skips malformed lines', async () => {
    const writer = createSessionWriter({
      filePath,
      context: { sessionId: 's1', cwd: '/tmp/test' },
      drainIntervalMs: 0,
    })
    const good = makeUser('good line')
    writer.append(good)
    await writer.close()

    // Append a truncated line (simulates a SIGKILL mid-write).
    appendFileSync(filePath, '{"type":"user","uuid":"broken","timest')
    // Then another valid entry.
    appendFileSync(filePath, '\n')
    appendFileSync(
      filePath,
      JSON.stringify({
        type: 'user',
        uuid: 'recovered-1',
        timestamp: '2026-04-08T10:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'after crash' }] },
        parentUuid: null,
        sessionId: 's1',
        cwd: '/tmp/test',
        version: '1',
      }) + '\n',
    )

    const loaded = await loadSession(filePath)
    expect(loaded!.map(m => m.uuid)).toEqual([good.uuid, 'recovered-1'])
  })

  test('reader skips entries with unknown type', async () => {
    const file = path.join(tmp, 'mixed.jsonl')
    const lines = [
      JSON.stringify({
        type: 'future_kind',
        uuid: 'x',
        timestamp: '2026-04-08T10:00:00.000Z',
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-04-08T10:00:01.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'ok' }] },
      }),
    ]
    writeFileSync(file, lines.join('\n') + '\n')
    const loaded = await loadSession(file)
    expect(loaded!.map(m => m.uuid)).toEqual(['u1'])
  })

  test('written envelope contains parentUuid chain', async () => {
    const writer = createSessionWriter({
      filePath,
      context: { sessionId: 's1', cwd: '/tmp/test' },
      drainIntervalMs: 0,
    })
    const u = makeUser('first')
    const a = makeAssistant('reply')
    writer.append(u)
    writer.append(a)
    await writer.close()

    const raw = readFileSync(filePath, 'utf8').trim().split('\n').map(l => JSON.parse(l))
    expect(raw[0].parentUuid).toBeNull()
    expect(raw[0].uuid).toBe(u.uuid)
    expect(raw[1].parentUuid).toBe(u.uuid)
    expect(raw[1].uuid).toBe(a.uuid)
  })

  test('initialParentUuid seeds the chain for resume', async () => {
    const writer = createSessionWriter({
      filePath,
      context: { sessionId: 's1', cwd: '/tmp/test' },
      drainIntervalMs: 0,
      initialParentUuid: 'resumed-parent',
    })
    const m = makeUser('continuation')
    writer.append(m)
    await writer.close()

    const raw = readFileSync(filePath, 'utf8').trim().split('\n').map(l => JSON.parse(l))
    expect(raw[0].parentUuid).toBe('resumed-parent')
  })
})
