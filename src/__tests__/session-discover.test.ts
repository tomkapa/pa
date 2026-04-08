import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { UserMessage } from '../types/message.js'
import {
  listProjectSessions,
  findMostRecentSession,
  findSessionById,
  summarizeSessions,
} from '../services/session/discover.js'
import { getProjectDir, getSessionFilePath } from '../services/session/paths.js'
import { createSessionWriter } from '../services/session/writer.js'

function makeUser(text: string): UserMessage {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: [{ type: 'text', text }] },
  }
}

function writeJsonlSession(file: string, lines: object[]): void {
  writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
}

describe('session discover', () => {
  let tmp: string
  let originalEnv: string | undefined
  const cwd = '/tmp/pa-discover-test-project'

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'pa-session-disc-'))
    originalEnv = process.env.PA_CONFIG_DIR
    process.env.PA_CONFIG_DIR = tmp
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PA_CONFIG_DIR
    else process.env.PA_CONFIG_DIR = originalEnv
    rmSync(tmp, { recursive: true, force: true })
  })

  test('listProjectSessions returns [] when dir missing', async () => {
    const result = await listProjectSessions(cwd)
    expect(result).toEqual([])
  })

  test('listProjectSessions returns sessions sorted newest first', async () => {
    const dir = getProjectDir(cwd)
    mkdirSync(dir, { recursive: true })
    const older = '00000000-0000-4000-8000-000000000001'
    const newer = '00000000-0000-4000-8000-000000000002'
    writeFileSync(path.join(dir, `${older}.jsonl`), '')
    writeFileSync(path.join(dir, `${newer}.jsonl`), '')
    // Force mtime ordering: older gets an earlier mtime.
    utimesSync(path.join(dir, `${older}.jsonl`), new Date(2020, 0, 1), new Date(2020, 0, 1))
    utimesSync(path.join(dir, `${newer}.jsonl`), new Date(2024, 0, 1), new Date(2024, 0, 1))

    const result = await listProjectSessions(cwd)
    expect(result.map(s => s.id)).toEqual([newer, older])
  })

  test('listProjectSessions ignores non-session files', async () => {
    const dir = getProjectDir(cwd)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, '.DS_Store'), 'junk')
    writeFileSync(path.join(dir, 'README.md'), 'not a session')
    writeFileSync(path.join(dir, 'notes.jsonl'), 'not a uuid')
    const real = '00000000-0000-4000-8000-00000000abcd'
    writeFileSync(path.join(dir, `${real}.jsonl`), '')

    const result = await listProjectSessions(cwd)
    expect(result.map(s => s.id)).toEqual([real])
  })

  test('findMostRecentSession returns null when none exist', async () => {
    expect(await findMostRecentSession(cwd)).toBeNull()
  })

  test('findMostRecentSession returns the newest entry', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000099'
    const writer = createSessionWriter({
      filePath: getSessionFilePath(cwd, sessionId),
      context: { sessionId, cwd },
      drainIntervalMs: 0,
    })
    writer.append(makeUser('hello there'))
    await writer.close()

    const result = await findMostRecentSession(cwd)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(sessionId)
  })

  test('findSessionById resolves a specific id', async () => {
    const dir = getProjectDir(cwd)
    mkdirSync(dir, { recursive: true })
    const id = '00000000-0000-4000-8000-0000000000aa'
    writeFileSync(path.join(dir, `${id}.jsonl`), '')

    const result = await findSessionById(cwd, id)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(id)

    const missing = await findSessionById(cwd, '00000000-0000-4000-8000-0000deadbeef')
    expect(missing).toBeNull()
  })

  test('summarizeSessions extracts first user-turn text', async () => {
    const dir = getProjectDir(cwd)
    mkdirSync(dir, { recursive: true })
    const id = '00000000-0000-4000-8000-0000000000bb'
    writeJsonlSession(path.join(dir, `${id}.jsonl`), [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-04-08T10:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'How do I fix a bug?' }] },
        parentUuid: null,
        sessionId: id,
        cwd,
        version: '1',
      },
    ])

    const sessions = await listProjectSessions(cwd)
    const summaries = await summarizeSessions(sessions)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.summary).toBe('How do I fix a bug?')
    expect(summaries[0]!.messageCount).toBe(1)
  })

  test('summarizeSessions truncates long summaries', async () => {
    const dir = getProjectDir(cwd)
    mkdirSync(dir, { recursive: true })
    const id = '00000000-0000-4000-8000-0000000000cc'
    const long = 'x'.repeat(200)
    writeJsonlSession(path.join(dir, `${id}.jsonl`), [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-04-08T10:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: long }] },
        parentUuid: null,
        sessionId: id,
        cwd,
        version: '1',
      },
    ])
    const sessions = await listProjectSessions(cwd)
    const summaries = await summarizeSessions(sessions)
    expect(summaries[0]!.summary.length).toBeLessThanOrEqual(80)
    expect(summaries[0]!.summary.endsWith('…')).toBe(true)
  })

  test('summarizeSessions skips meta/tool-result messages', async () => {
    const dir = getProjectDir(cwd)
    mkdirSync(dir, { recursive: true })
    const id = '00000000-0000-4000-8000-0000000000dd'
    writeJsonlSession(path.join(dir, `${id}.jsonl`), [
      {
        type: 'user',
        uuid: 'meta',
        timestamp: '2026-04-08T10:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'system injected' }] },
        isMeta: true,
        parentUuid: null,
        sessionId: id,
        cwd,
        version: '1',
      },
      {
        type: 'user',
        uuid: 'real',
        timestamp: '2026-04-08T10:00:01.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'the real question' }] },
        parentUuid: 'meta',
        sessionId: id,
        cwd,
        version: '1',
      },
    ])
    const sessions = await listProjectSessions(cwd)
    const summaries = await summarizeSessions(sessions)
    expect(summaries[0]!.summary).toBe('the real question')
  })
})
