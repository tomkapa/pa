import { useState, useEffect, useMemo } from 'react'
import { Box, Text, useInput } from '../ink.js'
import { Select, type SelectOption } from './select.js'
import {
  listProjectSessions,
  summarizeSessions,
  type SessionSummary,
} from '../services/session/index.js'
import { getErrorMessage } from '../utils/error.js'

const MAX_SESSIONS = 20

interface SessionPickerProps {
  cwd: string
  /** Receives the picked session directly so the caller doesn't re-scan the directory. */
  onSelect: (summary: SessionSummary) => void
  onCancel: () => void
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; summaries: SessionSummary[] }

export function SessionPicker({ cwd, onSelect, onCancel }: SessionPickerProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const sessions = await listProjectSessions(cwd)
        if (sessions.length === 0) {
          if (!cancelled) setState({ kind: 'empty' })
          return
        }
        const summaries = await summarizeSessions(sessions, MAX_SESSIONS)
        if (!cancelled) {
          if (summaries.length === 0) setState({ kind: 'empty' })
          else setState({ kind: 'ready', summaries })
        }
      } catch (error: unknown) {
        if (!cancelled) setState({ kind: 'error', message: getErrorMessage(error) })
      }
    }
    void load()
    return () => { cancelled = true }
  }, [cwd])

  // Esc cancels from any state so the picker feels responsive even while
  // discovery is still running.
  useInput((_ch, key) => {
    if (key.escape) onCancel()
  })

  const summaries = state.kind === 'ready' ? state.summaries : null
  const options = useMemo<SelectOption<string>[]>(
    () => summaries?.map(s => ({ value: s.id, label: formatOption(s) })) ?? [],
    [summaries],
  )

  if (state.kind === 'loading') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan" bold>Resume a session</Text>
        <Text color="gray">Loading…</Text>
      </Box>
    )
  }
  if (state.kind === 'empty') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="gray">No previous sessions in this project.</Text>
        <Text color="gray">Press esc to continue.</Text>
      </Box>
    )
  }
  if (state.kind === 'error') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red" bold>Could not list sessions</Text>
        <Text color="red">{state.message}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>Resume a session</Text>
      <Text color="gray">↑/↓ to move · enter to resume · esc to cancel</Text>
      <Box marginTop={1}>
        <Select
          options={options}
          onSelect={(id) => {
            const picked = state.summaries.find(s => s.id === id)
            if (picked) onSelect(picked)
          }}
        />
      </Box>
    </Box>
  )
}

function formatOption(s: SessionSummary): string {
  const when = formatRelativeTime(s.mtimeMs)
  const count = `${s.messageCount} msg`
  return `${when.padEnd(14)}  ${count.padEnd(8)}  ${s.summary}`
}

export function formatRelativeTime(mtimeMs: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - mtimeMs)
  const sec = Math.floor(diff / 1000)
  if (sec < 30) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo ago`
  const yr = Math.floor(day / 365)
  return `${yr}y ago`
}
