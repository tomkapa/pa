import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  writeToMailbox,
  readMailbox,
  markRead,
} from '../services/teams/mailbox.js'
import { createTeam } from '../services/teams/team-file.js'
import type { TeammateMessage } from '../services/teams/types.js'

let tempHome: string
let prevHome: string | undefined

beforeEach(async () => {
  tempHome = await mkdtemp(path.join(tmpdir(), 'pa-mailbox-'))
  prevHome = process.env['PA_HOME']
  process.env['PA_HOME'] = tempHome
  await createTeam({ teamName: 'team', description: '', leadAgentId: 'team-lead@team' })
})

afterEach(async () => {
  if (prevHome === undefined) delete process.env['PA_HOME']
  else process.env['PA_HOME'] = prevHome
  await rm(tempHome, { recursive: true, force: true })
})

function makeMessage(overrides: Partial<TeammateMessage> = {}): TeammateMessage {
  return {
    from: 'sender',
    text: 'hello',
    timestamp: new Date().toISOString(),
    read: false,
    ...overrides,
  }
}

describe('mailbox', () => {
  test('empty inbox returns []', async () => {
    const inbox = await readMailbox('team', 'nobody')
    expect(inbox).toEqual([])
  })

  test('writeToMailbox appends messages in order', async () => {
    await writeToMailbox('team', 'alice', makeMessage({ timestamp: '2026-01-01T00:00:00.000Z' }))
    await writeToMailbox('team', 'alice', makeMessage({ timestamp: '2026-01-01T00:00:01.000Z', text: 'second' }))
    const inbox = await readMailbox('team', 'alice')
    expect(inbox).toHaveLength(2)
    expect(inbox[0]!.text).toBe('hello')
    expect(inbox[1]!.text).toBe('second')
  })

  test('markRead flips the flag on matching timestamps only', async () => {
    const t1 = '2026-01-01T00:00:00.000Z'
    const t2 = '2026-01-01T00:00:01.000Z'
    await writeToMailbox('team', 'alice', makeMessage({ timestamp: t1 }))
    await writeToMailbox('team', 'alice', makeMessage({ timestamp: t2, text: 'second' }))
    await markRead('team', 'alice', [t1])
    const inbox = await readMailbox('team', 'alice')
    expect(inbox.find(m => m.timestamp === t1)!.read).toBe(true)
    expect(inbox.find(m => m.timestamp === t2)!.read).toBe(false)
  })

  test('concurrent writers do not corrupt the JSON array', async () => {
    const writes: Promise<void>[] = []
    for (let i = 0; i < 20; i++) {
      writes.push(
        writeToMailbox('team', 'bob', makeMessage({
          text: `msg-${i}`,
          // Each timestamp unique; Date.now() collisions would also work
          timestamp: new Date(Date.now() + i).toISOString(),
        })),
      )
    }
    await Promise.all(writes)
    const inbox = await readMailbox('team', 'bob')
    expect(inbox).toHaveLength(20)
    const texts = new Set(inbox.map(m => m.text))
    for (let i = 0; i < 20; i++) expect(texts.has(`msg-${i}`)).toBe(true)
  })

  test('markRead no-ops when timestamps is empty', async () => {
    await writeToMailbox('team', 'alice', makeMessage())
    await markRead('team', 'alice', [])
    const inbox = await readMailbox('team', 'alice')
    expect(inbox[0]!.read).toBe(false)
  })
})
