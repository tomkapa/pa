import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { isNodeError } from '../../utils/error.js'
import { extractTextFromContent } from '../messages/factory.js'
import type { Message } from '../../types/message.js'
import { getProjectDir } from './paths.js'
import { loadSession } from './reader.js'

// Cheap input filter so `.DS_Store`, editor backup files, etc. can't be
// mistaken for session files.
const SESSION_FILE_REGEX =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

export interface SessionInfo {
  id: string
  path: string
  mtimeMs: number
}

export interface SessionSummary extends SessionInfo {
  /** First human-turn text, truncated for the picker. Empty if not found. */
  summary: string
  messageCount: number
}

/** Every session file in the per-project directory, newest first. Missing
 *  directory is the "no history yet" case and returns []. */
export async function listProjectSessions(cwd: string): Promise<SessionInfo[]> {
  const dir = getProjectDir(cwd)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }

  const candidates: Array<{ id: string; full: string }> = []
  for (const name of entries) {
    const match = SESSION_FILE_REGEX.exec(name)
    if (!match) continue
    candidates.push({ id: match[1]!, full: path.join(dir, name) })
  }

  const statted = await Promise.all(
    candidates.map(async ({ id, full }): Promise<SessionInfo | null> => {
      try {
        const s = await stat(full)
        if (!s.isFile()) return null
        return { id, path: full, mtimeMs: s.mtimeMs }
      } catch {
        // File vanished between readdir and stat, or perm error. Skip.
        return null
      }
    }),
  )

  const infos = statted.filter((x): x is SessionInfo => x !== null)
  infos.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return infos
}

/** Most-recently-touched session in the project, or null if none exist. */
export async function findMostRecentSession(cwd: string): Promise<SessionInfo | null> {
  const all = await listProjectSessions(cwd)
  return all[0] ?? null
}

/** Look up a session by id. Returns null if not found. */
export async function findSessionById(
  cwd: string,
  sessionId: string,
): Promise<SessionInfo | null> {
  const all = await listProjectSessions(cwd)
  return all.find(s => s.id === sessionId) ?? null
}

const SUMMARY_MAX_CHARS = 80

// Loads the full file per candidate; CODE-139 will replace with head/tail
// metadata extraction when listing thousands becomes a problem.
export async function summarizeSessions(
  sessions: readonly SessionInfo[],
  limit = 20,
): Promise<SessionSummary[]> {
  const slice = sessions.slice(0, limit)
  const loaded = await Promise.all(
    slice.map(async (info): Promise<SessionSummary | null> => {
      const messages = await loadSession(info.path)
      if (!messages) return null
      return {
        ...info,
        summary: firstHumanTurnText(messages),
        messageCount: messages.length,
      }
    }),
  )
  return loaded.filter((x): x is SessionSummary => x !== null)
}

function firstHumanTurnText(messages: readonly Message[]): string {
  for (const msg of messages) {
    if (msg.type !== 'user') continue
    if (msg.isMeta) continue
    if (msg.toolUseResult !== undefined) continue
    const text = extractTextFromContent(msg.message.content).trim()
    if (text.length === 0) continue
    return text.length > SUMMARY_MAX_CHARS
      ? text.slice(0, SUMMARY_MAX_CHARS - 1) + '…'
      : text
  }
  return '(no user messages)'
}
