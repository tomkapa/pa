import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { Message } from '../../types/message.js'
import { wrapMessage, type EnvelopeContext, type SerializedMessage } from './envelope.js'

// Relies on POSIX O_APPEND atomicity for single write(2) calls — no lockfile.
// Lazy file creation: no empty file if the process exits before the first
// append. Bursty writes coalesce into one appendFile per drain window.
// `append()` after `close()` is a no-op; any further messages belong to a
// fresh session.

const DEFAULT_DRAIN_INTERVAL_MS = 100

export interface SessionWriterOptions {
  filePath: string
  context: EnvelopeContext
  /** Override the drain interval. Tests use 0 to flush synchronously. */
  drainIntervalMs?: number
  /**
   * Seed for the parent-uuid chain. When resuming an existing session, pass
   * the uuid of the last loaded message so the chain continues across the
   * resume boundary. Defaults to `null` for fresh sessions.
   */
  initialParentUuid?: string | null
}

export interface SessionWriter {
  /** Queue a message for persistence. Stamps an envelope before buffering. */
  append(message: Message): void
  /** Flush and stop. Safe to call multiple times. */
  close(): Promise<void>
  /** Session file path, for callers that need to show/log it. */
  readonly filePath: string
  /** Session id this writer is persisting to. */
  readonly sessionId: string
}

export function createSessionWriter(opts: SessionWriterOptions): SessionWriter {
  const drainIntervalMs = opts.drainIntervalMs ?? DEFAULT_DRAIN_INTERVAL_MS

  let pending: SerializedMessage[] = []
  let flushing = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let dirEnsured = false
  /** Parent UUID chain: updated as each message is queued (not as it writes)
   *  so a burst of appends still produces a well-linked chain. */
  let lastUuid: string | null = opts.initialParentUuid ?? null

  async function ensureDirOnce(): Promise<void> {
    if (dirEnsured) return
    await mkdir(path.dirname(opts.filePath), { recursive: true })
    dirEnsured = true
  }

  async function drain(): Promise<void> {
    timer = null
    if (flushing || pending.length === 0) return
    flushing = true
    const batch = pending
    pending = []
    try {
      await ensureDirOnce()
      const lines = batch.map(m => JSON.stringify(m) + '\n').join('')
      await appendFile(opts.filePath, lines, { mode: 0o600 })
    } catch (error) {
      // Re-queue the batch so a transient failure doesn't drop data. The
      // caller's cleanup hook will retry on close(). If close() also fails
      // the error propagates. Intentionally NOT swallowed.
      pending = [...batch, ...pending]
      throw error
    } finally {
      flushing = false
      if (pending.length > 0 && !timer && !closed) {
        timer = setTimeout(() => { void drain() }, drainIntervalMs)
      }
    }
  }

  function scheduleDrain(): void {
    if (timer || flushing || closed) return
    if (drainIntervalMs === 0) {
      void drain()
      return
    }
    timer = setTimeout(() => { void drain() }, drainIntervalMs)
  }

  return {
    filePath: opts.filePath,
    sessionId: opts.context.sessionId,

    append(message: Message): void {
      if (closed) return
      const envelope = wrapMessage(message, opts.context, lastUuid)
      pending.push(envelope)
      lastUuid = message.uuid
      scheduleDrain()
    },

    async close(): Promise<void> {
      if (closed && pending.length === 0 && !flushing) return
      closed = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      // Drain anything queued, then spin until the in-flight write is done
      // and nothing new was requeued by a retry.
      while (pending.length > 0 || flushing) {
        if (!flushing) {
          await drain()
        } else {
          // Another drain is in flight — wait for it to land, then re-check.
          await new Promise(r => setTimeout(r, 5))
        }
      }
    },
  }
}
