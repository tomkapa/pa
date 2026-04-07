import { Text, Box } from '../ink.js'
import type { ReactNode } from 'react'
import type { BashToolInput, BashToolOutput } from './bashTool.js'
import type { ToolRenderOptions, ToolResultRenderOptions } from '../services/tools/types.js'

const MAX_COMMAND_DISPLAY_LINES = 2
const MAX_COMMAND_DISPLAY_CHARS = 160
const PREVIEW_OUTPUT_LINES = 10

function truncateCommand(command: string): string {
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
