import { useEffect } from 'react'
import { readMailbox, markRead } from '../services/teams/index.js'
import type { TeammateMessage } from '../services/teams/index.js'
import { logForDebugging } from '../services/observability/debug.js'

// Polls an agent's mailbox and delivers unread messages to a callback.
// Ordering: ISO-8601 timestamps sort lexicographically, so string sort is
// also chronological. Messages are marked read BEFORE dispatch; if the
// mark fails we skip dispatch rather than risk double-delivery on retry.

export interface UseInboxPollerOptions {
  agentName: string | undefined
  teamName: string | undefined
  onMessage: (msg: TeammateMessage) => void
  intervalMs?: number
  /** Skip polling entirely — gates the hook on an identity being set. */
  enabled?: boolean
}

const DEFAULT_INTERVAL_MS = 1_000

export function useInboxPoller(options: UseInboxPollerOptions): void {
  const { agentName, teamName, onMessage, intervalMs, enabled } = options

  useEffect(() => {
    if (enabled === false) return
    if (!agentName || !teamName) return

    let cancelled = false
    let inFlight = false

    async function tick(): Promise<void> {
      if (inFlight || cancelled) return
      inFlight = true
      try {
        const messages = await readMailbox(teamName!, agentName!)
        const unread = messages.filter(m => !m.read)
        if (unread.length === 0) return

        unread.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        try {
          await markRead(
            teamName!,
            agentName!,
            unread.map(m => m.timestamp),
          )
        } catch (error) {
          logForDebugging(
            `inbox_poll_mark_failed: agent="${agentName}" team="${teamName}" error="${String(error)}"`,
            { level: 'warn' },
          )
          return
        }

        if (cancelled) return
        for (const msg of unread) onMessage(msg)
      } catch (error) {
        logForDebugging(
          `inbox_poll_read_failed: agent="${agentName}" team="${teamName}" error="${String(error)}"`,
          { level: 'warn' },
        )
      } finally {
        inFlight = false
      }
    }

    const handle = setInterval(() => { void tick() }, intervalMs ?? DEFAULT_INTERVAL_MS)
    // Kick off immediately so the teammate's seed prompt isn't delayed a full interval.
    void tick()

    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [agentName, teamName, onMessage, intervalMs, enabled])
}
