import { Text, Box } from '../ink.js'
import type { ReactNode } from 'react'
import type { BashToolInput, BashToolOutput, BashProgress } from './bashTool.js'
import type {
  ProgressMessage,
  ToolProgressRenderOptions,
  ToolRenderOptions,
  ToolResultRenderOptions,
} from '../services/tools/types.js'
import { formatElapsed } from '../utils/time.js'

const MAX_COMMAND_DISPLAY_LINES = 2
const MAX_COMMAND_DISPLAY_CHARS = 160
const PREVIEW_OUTPUT_LINES = 10
// While a command is running, show at most this many trailing lines so a
// chatty command (e.g. `npm install`) doesn't blow out the terminal viewport.
const PROGRESS_TAIL_LINES = 8

export function truncateCommand(command: string): string {
  const lines = command.split('\n')
  const truncated = lines.slice(0, MAX_COMMAND_DISPLAY_LINES)
  let result = truncated.join('\n')
  if (result.length > MAX_COMMAND_DISPLAY_CHARS) {
    result = result.slice(0, MAX_COMMAND_DISPLAY_CHARS - 3) + '...'
  } else if (lines.length > MAX_COMMAND_DISPLAY_LINES) {
    result += '...'
  }
  return result
}

export function renderToolUseMessage(
  input: Partial<BashToolInput>,
  _options: ToolRenderOptions,
): ReactNode {
  if (!input.command) return null
  const display = truncateCommand(input.command)
  return <Text>{display}</Text>
}

export function renderToolResultMessage(
  output: BashToolOutput,
  options: ToolResultRenderOptions,
): ReactNode {
  const parts: ReactNode[] = []

  if (output.interrupted) {
    parts.push(<Text key="interrupted" color="yellow">Command interrupted</Text>)
  }

  if (output.exitCode !== 0 && !options.verbose) {
    parts.push(
      <Text key="exit" color="red">Exit code: {output.exitCode}</Text>,
    )
  }

  const combinedOutput = [
    output.stdout,
    output.stderr ? `stderr:\n${output.stderr}` : '',
  ].filter(Boolean).join('\n')

  if (!combinedOutput && parts.length === 0) {
    return <Text color="gray">(no output)</Text>
  }

  if (!options.verbose && combinedOutput) {
    const allLines = combinedOutput.split('\n')
    const preview = allLines.slice(0, PREVIEW_OUTPUT_LINES)
    const remaining = allLines.length - preview.length

    parts.push(
      <Box key="output" flexDirection="column">
        {preview.map((line, i) => <Text key={i}>{line}</Text>)}
        {remaining > 0 && (
          <Text color="gray">...{remaining} more lines</Text>
        )}
      </Box>,
    )
    if (output.exitCode !== 0) {
      parts.push(
        <Text key="exit-verbose" color="red">Exit code: {output.exitCode}</Text>,
      )
    }
  } else if (combinedOutput) {
    const lines = combinedOutput.split('\n')
    parts.push(
      <Box key="output" flexDirection="column">
        {lines.map((line, i) => <Text key={i}>{line}</Text>)}
      </Box>,
    )
    if (output.exitCode !== 0) {
      parts.push(
        <Text key="exit-code" color="red">Exit code: {output.exitCode}</Text>,
      )
    }
  }

  return <Box flexDirection="column">{parts}</Box>
}

export function isResultTruncated(output: BashToolOutput): boolean {
  const totalLines = [output.stdout, output.stderr].join('\n').split('\n').length
  return totalLines > PREVIEW_OUTPUT_LINES
}

export function getActivityDescription(input?: Partial<BashToolInput>): string | null {
  if (!input?.command) return null
  return truncateCommand(input.command)
}

// ---------------------------------------------------------------------------
// Progress rendering — streaming UI shown WHILE a Bash command runs
// ---------------------------------------------------------------------------

function isBashProgress(data: unknown): data is BashProgress {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return (
    typeof d.stdout === 'string' &&
    typeof d.stderr === 'string' &&
    typeof d.elapsedMs === 'number'
  )
}

function tailLines(text: string, maxLines: number, maxLineWidth: number): string[] {
  if (!text) return []
  // Walk backward from the end to find the start of the trailing N lines —
  // avoids splitting a multi-MB buffer just to throw away all but the last 8.
  let cut = text.length
  for (let found = 0; found < maxLines; found++) {
    const prev = text.lastIndexOf('\n', cut - 1)
    if (prev < 0) { cut = 0; break }
    cut = prev
  }
  const slice = cut === 0 ? text : text.slice(cut + 1)
  return slice.split('\n').map(line =>
    line.length > maxLineWidth ? line.slice(0, maxLineWidth - 1) + '…' : line,
  )
}

/**
 * Live progress UI for the Bash tool. Streams stdout/stderr as the command
 * runs, truncated to the trailing N lines so a chatty command can't push
 * the rest of the REPL off-screen. Shows elapsed time so silent commands
 * still feel alive. Returns null if no progress has arrived yet.
 */
export function renderToolUseProgressMessage(
  progressMessages: ProgressMessage[],
  options: ToolProgressRenderOptions,
): ReactNode {
  if (progressMessages.length === 0) return null

  // The latest message has the most up-to-date accumulated buffers.
  const latest = progressMessages[progressMessages.length - 1]
  if (!latest || !isBashProgress(latest.data)) return null
  const { stdout, stderr, elapsedMs } = latest.data

  // Reserve a few columns for the leading "│ " gutter so the truncation math
  // matches what the user actually sees in their terminal.
  const maxLineWidth = Math.max(20, (options.columns ?? 80) - 4)
  const stdoutTail = tailLines(stdout, PROGRESS_TAIL_LINES, maxLineWidth)
  const stderrTail = tailLines(stderr, PROGRESS_TAIL_LINES, maxLineWidth)

  const elapsedLabel = `running (${formatElapsed(elapsedMs)})`

  return (
    <Box flexDirection="column">
      <Text color="yellow">{`⏵ ${elapsedLabel}`}</Text>
      {stdoutTail.length > 0 && (
        <Box flexDirection="column">
          {stdoutTail.map((line, i) => (
            <Text key={`out-${i}`} color="gray">{`│ ${line}`}</Text>
          ))}
        </Box>
      )}
      {stderrTail.length > 0 && (
        <Box flexDirection="column">
          {stderrTail.map((line, i) => (
            <Text key={`err-${i}`} color="red">{`│ ${line}`}</Text>
          ))}
        </Box>
      )}
      {stdoutTail.length === 0 && stderrTail.length === 0 && (
        <Text color="gray">│ (no output yet)</Text>
      )}
    </Box>
  )
}
