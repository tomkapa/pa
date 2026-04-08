import { spawnSync } from 'node:child_process'
import type { Message } from '../../types/message.js'

/** Bump when the on-disk shape changes; loaders branch on this. */
export const SESSION_SCHEMA_VERSION = '1'

export interface EnvelopeContext {
  sessionId: string
  cwd: string
  gitBranch?: string | undefined
}

export interface EnvelopeMeta {
  parentUuid: string | null
  sessionId: string
  timestamp: string
  cwd: string
  version: string
  gitBranch?: string
  /** Reserved for future subagent transcripts (CODE-42). */
  isSidechain?: boolean
}

/** A Message plus envelope, flat-merged into a single JSONL-friendly object. */
export type SerializedMessage = Message & EnvelopeMeta

export function wrapMessage(
  msg: Message,
  ctx: EnvelopeContext,
  parentUuid: string | null,
): SerializedMessage {
  return {
    ...msg,
    parentUuid,
    sessionId: ctx.sessionId,
    // Preserve the message's own timestamp (captured at creation) so replay
    // times match the original conversation order, not the flush time.
    timestamp: msg.timestamp,
    cwd: ctx.cwd,
    version: SESSION_SCHEMA_VERSION,
    ...(ctx.gitBranch ? { gitBranch: ctx.gitBranch } : {}),
  }
}

export function unwrapMessage(serialized: SerializedMessage): Message {
  const {
    parentUuid: _parentUuid,
    sessionId: _sessionId,
    cwd: _cwd,
    version: _version,
    gitBranch: _gitBranch,
    isSidechain: _isSidechain,
    ...rest
  } = serialized
  return rest as Message
}

const gitBranchCache = new Map<string, string | undefined>()

/** Best-effort current git branch; undefined outside a repo. Cached per-cwd. */
export function getGitBranch(cwd: string): string | undefined {
  if (gitBranchCache.has(cwd)) return gitBranchCache.get(cwd)
  let branch: string | undefined
  try {
    const result = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (result.status === 0) {
      const trimmed = result.stdout.trim()
      if (trimmed.length > 0) branch = trimmed
    }
  } catch {
    // git not installed, spawn failed, detached HEAD, etc.
  }
  gitBranchCache.set(cwd, branch)
  return branch
}

/** Test helper: forget cached git branches between test files. */
export function clearGitBranchCache(): void {
  gitBranchCache.clear()
}
