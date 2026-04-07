import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  __flushDumpPromptsForTests,
  __resetDumpPromptsForTests,
  createDumpPromptsFetch,
  getRecentRequests,
  type FetchLike,
} from '../services/observability/dumpPrompts.js'
import { getSessionId } from '../services/observability/state.js'
import { snapshotEnv } from '../testing/env-snapshot.js'

let tmp: string
let restoreEnv: () => void

function dumpFile(): string {
  return join(tmp, 'dump-prompts', `${getSessionId()}.jsonl`)
}

function readDumpLines(): Array<{ type: string; data: any }> {
  const path = dumpFile()
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(l => l.length > 0)
    .map(l => JSON.parse(l) as { type: string; data: any })
}

beforeEach(() => {
  restoreEnv = snapshotEnv(['PA_HOME', 'PA_DUMP_PROMPTS', 'NODE_ENV'])
  tmp = mkdtempSync(join(tmpdir(), 'pa-dump-test-'))
  process.env['PA_HOME'] = tmp
  process.env['PA_DUMP_PROMPTS'] = '1'
  delete process.env['NODE_ENV']
  __resetDumpPromptsForTests()
})

afterEach(() => {
  __resetDumpPromptsForTests()
  rmSync(tmp, { recursive: true, force: true })
  restoreEnv()
})

function makeJsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function makeSseResponse(events: string[]): Response {
  const text = events.map(e => `event: message\ndata: ${e}`).join('\n\n') + '\n\n'
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('observability/dumpPrompts', () => {
  test('writes init + message + response on first request', async () => {
    const fakeFetch: FetchLike = async () => makeJsonResponse({ id: 'msg_1', content: [] })
    const wrapped = createDumpPromptsFetch(fakeFetch)

    const body = JSON.stringify({
      model: 'claude-test',
      max_tokens: 100,
      system: [{ type: 'text', text: 'You are helpful.' }],
      tools: [{ name: 'BashTool' }],
      messages: [{ role: 'user', content: 'hi' }],
    })
    await wrapped('https://api.anthropic.com/v1/messages', { method: 'POST', body })
    await __flushDumpPromptsForTests()

    const lines = readDumpLines()
    expect(lines.length).toBeGreaterThanOrEqual(3)
    expect(lines[0]!.type).toBe('init')
    expect(lines[0]!.data).toMatchObject({
      model: 'claude-test',
      max_tokens: 100,
    })
    // init record must NOT contain messages
    expect(lines[0]!.data.messages).toBeUndefined()

    const messageRecords = lines.filter(l => l.type === 'message')
    expect(messageRecords.length).toBe(1)
    expect(messageRecords[0]!.data).toMatchObject({ role: 'user', content: 'hi' })

    const responseRecords = lines.filter(l => l.type === 'response')
    expect(responseRecords.length).toBe(1)
    expect(responseRecords[0]!.data.streaming).toBe(false)
    expect(responseRecords[0]!.data.body).toMatchObject({ id: 'msg_1' })
  })

  test('multi-turn: only one init + delta messages, no duplication', async () => {
    const fakeFetch: FetchLike = async () => makeJsonResponse({ id: 'msg', content: [] })
    const wrapped = createDumpPromptsFetch(fakeFetch)

    const turn1 = JSON.stringify({
      model: 'claude-test',
      system: [{ type: 'text', text: 'sys' }],
      messages: [{ role: 'user', content: 'one' }],
    })
    const turn2 = JSON.stringify({
      model: 'claude-test',
      system: [{ type: 'text', text: 'sys' }],
      messages: [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'two' },
      ],
    })
    await wrapped('https://api.anthropic.com/v1/messages', { method: 'POST', body: turn1 })
    await __flushDumpPromptsForTests()
    await wrapped('https://api.anthropic.com/v1/messages', { method: 'POST', body: turn2 })
    await __flushDumpPromptsForTests()

    const lines = readDumpLines()
    const inits = lines.filter(l => l.type === 'init')
    const updates = lines.filter(l => l.type === 'system_update')
    const msgs = lines.filter(l => l.type === 'message')
    expect(inits.length).toBe(1)
    expect(updates.length).toBe(0)
    // user/one (turn 1), assistant/a1 + user/two (turn 2 deltas) = 3
    expect(msgs.length).toBe(3)
    expect(msgs[0]!.data).toMatchObject({ role: 'user', content: 'one' })
    expect(msgs[1]!.data).toMatchObject({ role: 'assistant', content: 'a1' })
    expect(msgs[2]!.data).toMatchObject({ role: 'user', content: 'two' })
  })

  test('emits system_update when system prompt actually changes', async () => {
    const fakeFetch: FetchLike = async () => makeJsonResponse({ id: 'msg', content: [] })
    const wrapped = createDumpPromptsFetch(fakeFetch)

    await wrapped('https://api/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'm',
        system: [{ type: 'text', text: 'first' }],
        messages: [{ role: 'user', content: 'a' }],
      }),
    })
    await __flushDumpPromptsForTests()
    await wrapped('https://api/messages', {
      method: 'POST',
      body: JSON.stringify({
        model: 'm',
        system: [{ type: 'text', text: 'second prompt different length' }],
        messages: [{ role: 'user', content: 'a' }],
      }),
    })
    await __flushDumpPromptsForTests()

    const lines = readDumpLines()
    expect(lines.filter(l => l.type === 'init').length).toBe(1)
    expect(lines.filter(l => l.type === 'system_update').length).toBe(1)
  })

  test('captures streaming SSE response chunks', async () => {
    const fakeFetch: FetchLike = async () =>
      makeSseResponse(['{"type":"message_start"}', '{"type":"message_stop"}'])
    const wrapped = createDumpPromptsFetch(fakeFetch)

    await wrapped('https://api/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'go' }] }),
    })
    await __flushDumpPromptsForTests()

    const lines = readDumpLines()
    const responses = lines.filter(l => l.type === 'response')
    expect(responses.length).toBe(1)
    expect(responses[0]!.data.streaming).toBe(true)
    expect(Array.isArray(responses[0]!.data.chunks)).toBe(true)
    expect(responses[0]!.data.chunks.length).toBe(2)
  })

  test('returns the original response unmodified', async () => {
    const expected = makeJsonResponse({ id: 'verify' })
    const fakeFetch: FetchLike = async () => expected
    const wrapped = createDumpPromptsFetch(fakeFetch)

    const got = await wrapped('https://api/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'm', messages: [] }),
    })
    expect(await got.json()).toEqual({ id: 'verify' })
  })

  test('ring buffer holds the last 5 requests', async () => {
    const fakeFetch: FetchLike = async () => makeJsonResponse({ ok: true })
    const wrapped = createDumpPromptsFetch(fakeFetch)

    for (let i = 0; i < 7; i++) {
      await wrapped('https://api/messages', {
        method: 'POST',
        body: JSON.stringify({ model: 'm', n: i, messages: [] }),
      })
    }
    await __flushDumpPromptsForTests()

    const recent = getRecentRequests()
    expect(recent.length).toBe(5)
    const firstN = (recent[0]!.body as { n: number }).n
    const lastN = (recent[recent.length - 1]!.body as { n: number }).n
    expect(firstN).toBe(2)
    expect(lastN).toBe(6)
  })
})
