import {
  withFileLock,
  readJsonOrFallback,
  writeJson,
} from './lock.js'
import { getInboxPath } from './paths.js'
import type { TeammateMessage } from './types.js'

// Each agent has a JSON-array inbox at `<team>/inboxes/<agent>.json`.
// Writes are serialized via a lockfile. Missing / empty / malformed files
// collapse to `[]` so the first-message path matches subsequent ones.

export async function writeToMailbox(
  teamName: string,
  recipientName: string,
  message: TeammateMessage,
): Promise<void> {
  const inboxPath = getInboxPath(teamName, recipientName)
  await withFileLock(inboxPath, async () => {
    const current = await readJsonOrFallback<TeammateMessage[]>(inboxPath, [])
    current.push(message)
    await writeJson(inboxPath, current)
  })
}

export async function readMailbox(
  teamName: string,
  agentName: string,
): Promise<TeammateMessage[]> {
  return readJsonOrFallback<TeammateMessage[]>(
    getInboxPath(teamName, agentName),
    [],
  )
}

export async function markRead(
  teamName: string,
  agentName: string,
  timestamps: readonly string[],
): Promise<void> {
  if (timestamps.length === 0) return
  const inboxPath = getInboxPath(teamName, agentName)
  const timestampSet = new Set(timestamps)
  await withFileLock(inboxPath, async () => {
    const current = await readJsonOrFallback<TeammateMessage[]>(inboxPath, [])
    let changed = false
    for (const message of current) {
      if (!message.read && timestampSet.has(message.timestamp)) {
        message.read = true
        changed = true
      }
    }
    if (changed) await writeJson(inboxPath, current)
  })
}
