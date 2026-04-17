import { useState, useEffect } from 'react'
import path from 'node:path'
import { Box, Text } from './ink.js'
import { REPL, type REPLSessionBinding } from './repl.js'
import { SessionPicker } from './components/session-picker.js'
import {
  createSessionWriter,
  findMostRecentSession,
  findSessionById,
  getGitBranch,
  getSessionFilePath,
  loadSession,
  type EnvelopeContext,
  type SessionInfo,
} from './services/session/index.js'
import { getErrorMessage } from './utils/error.js'
import type { PermissionMode } from './services/permissions/types.js'

export type SessionBoot =
  | { kind: 'fresh' }
  | { kind: 'continue' }
  | { kind: 'resume-id'; sessionId: string }
  | { kind: 'resume-pick' }

export interface AppProps {
  cwd: string
  boot: SessionBoot
  /** Initial permission mode, usually inherited by teammates from the leader. */
  initialPermissionMode?: PermissionMode
  /** Test hook — lets callers observe the writer after boot. */
  onWriterReady?: (binding: REPLSessionBinding) => void
}

type ResolveState =
  | { kind: 'resolving' }
  | { kind: 'picker' }
  | { kind: 'ready'; binding: REPLSessionBinding }
  | { kind: 'info'; message: string; binding: REPLSessionBinding }
  | { kind: 'error'; message: string }

export function App({ cwd, boot, initialPermissionMode, onWriterReady }: AppProps) {
  const [state, setState] = useState<ResolveState>({ kind: 'resolving' })

  useEffect(() => {
    let cancelled = false
    async function resolve(): Promise<void> {
      try {
        if (boot.kind === 'resume-pick') {
          if (!cancelled) setState({ kind: 'picker' })
          return
        }

        let existing: SessionInfo | null = null
        let infoMessage: string | undefined

        if (boot.kind === 'continue') {
          existing = await findMostRecentSession(cwd)
          if (!existing) {
            infoMessage = 'No previous session in this project. Starting fresh.'
          }
        } else if (boot.kind === 'resume-id') {
          existing = await findSessionById(cwd, boot.sessionId)
          if (!existing) {
            if (!cancelled) {
              setState({
                kind: 'error',
                message: `No session found with id ${boot.sessionId} in this project.`,
              })
            }
            return
          }
        }

        const binding = existing
          ? await openExistingSession(cwd, existing.path)
          : await createFreshSession(cwd)
        if (cancelled) return
        onWriterReady?.(binding)
        setState(
          infoMessage
            ? { kind: 'info', message: infoMessage, binding }
            : { kind: 'ready', binding },
        )
      } catch (error: unknown) {
        if (!cancelled) setState({ kind: 'error', message: getErrorMessage(error) })
      }
    }
    void resolve()
    return () => { cancelled = true }
  }, [boot, cwd, onWriterReady])

  if (state.kind === 'resolving') {
    return <Text color="gray">Loading session…</Text>
  }

  if (state.kind === 'error') {
    return <Text color="red">{state.message}</Text>
  }

  if (state.kind === 'picker') {
    return (
      <SessionPicker
        cwd={cwd}
        onSelect={async (picked) => {
          try {
            const binding = await openExistingSession(cwd, picked.path)
            onWriterReady?.(binding)
            setState({ kind: 'ready', binding })
          } catch (error: unknown) {
            setState({ kind: 'error', message: getErrorMessage(error) })
          }
        }}
        onCancel={async () => {
          // User bailed on the picker — drop into a fresh session so they
          // don't have to re-launch `pa`.
          try {
            const binding = await createFreshSession(cwd)
            onWriterReady?.(binding)
            setState({ kind: 'info', message: 'Starting a new session.', binding })
          } catch (error: unknown) {
            setState({ kind: 'error', message: getErrorMessage(error) })
          }
        }}
      />
    )
  }

  if (state.kind === 'info') {
    return (
      <Box flexDirection="column">
        <Text color="gray">{state.message}</Text>
        <REPL session={state.binding} initialPermissionMode={initialPermissionMode} />
      </Box>
    )
  }

  return <REPL session={state.binding} initialPermissionMode={initialPermissionMode} />
}

async function openExistingSession(
  cwd: string,
  filePath: string,
): Promise<REPLSessionBinding> {
  const loaded = (await loadSession(filePath)) ?? []
  const sessionId = sessionIdFromPath(filePath)
  const ctx: EnvelopeContext = { sessionId, cwd, gitBranch: getGitBranch(cwd) }
  const writer = createSessionWriter({
    filePath,
    context: ctx,
    initialParentUuid: loaded.at(-1)?.uuid ?? null,
  })
  return { writer, initialMessages: loaded }
}

async function createFreshSession(cwd: string): Promise<REPLSessionBinding> {
  const sessionId = crypto.randomUUID()
  const filePath = getSessionFilePath(cwd, sessionId)
  const ctx: EnvelopeContext = { sessionId, cwd, gitBranch: getGitBranch(cwd) }
  const writer = createSessionWriter({ filePath, context: ctx })
  return { writer, initialMessages: [] }
}

function sessionIdFromPath(p: string): string {
  const base = path.basename(p)
  return base.endsWith('.jsonl') ? base.slice(0, -'.jsonl'.length) : base
}
