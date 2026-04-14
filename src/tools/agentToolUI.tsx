import { Text, Box } from '../ink.js'
import type { ReactNode } from 'react'
import type { ProgressMessage, ToolProgressRenderOptions } from '../services/tools/types.js'
import { formatElapsed } from '../utils/time.js'

// ---------------------------------------------------------------------------
// Progress data shape emitted by the agent tool during child execution
// ---------------------------------------------------------------------------

export type AgentActivityType = 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'error'

export interface AgentProgress {
  activity: AgentActivityType
  label: string
  elapsedMs: number
  log: AgentActivityEntry[]
}

export interface AgentActivityEntry {
  type: AgentActivityType
  label: string
  timestamp: number
}

export function isAgentProgress(data: unknown): data is AgentProgress {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return (
    typeof d.activity === 'string' &&
    typeof d.label === 'string' &&
    typeof d.elapsedMs === 'number' &&
    Array.isArray(d.log)
  )
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const MAX_LOG_LINES = 6

function activityIcon(type: AgentActivityType): string {
  switch (type) {
    case 'thinking': return '∴'
    case 'tool_use': return '⚙'
    case 'tool_result': return '✓'
    case 'text': return '▸'
    case 'error': return '✗'
  }
}

function activityColor(type: AgentActivityType): string {
  switch (type) {
    case 'thinking': return 'magenta'
    case 'tool_use': return 'cyan'
    case 'tool_result': return 'green'
    case 'text': return 'white'
    case 'error': return 'red'
  }
}

export function renderToolUseProgressMessage(
  progressMessages: ProgressMessage[],
  _options: ToolProgressRenderOptions,
): ReactNode {
  if (progressMessages.length === 0) return null

  const latest = progressMessages[progressMessages.length - 1]
  if (!latest || !isAgentProgress(latest.data)) return null

  const { elapsedMs, log } = latest.data
  const tail = log.slice(-MAX_LOG_LINES)

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingLeft={1} paddingRight={1}>
      <Text color="blue" bold>{`subagent (${formatElapsed(elapsedMs)})`}</Text>
      {tail.map((entry, i) => (
        <Text key={i} color={activityColor(entry.type)}>
          {`${activityIcon(entry.type)} ${entry.label}`}
        </Text>
      ))}
      {log.length > MAX_LOG_LINES && (
        <Text color="gray">{`  ...${log.length - MAX_LOG_LINES} earlier`}</Text>
      )}
    </Box>
  )
}
