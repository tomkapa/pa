import { Text, Box } from '../ink.js'
import type { ReactNode } from 'react'
import type { ReadToolInput, ReadToolOutput } from './readTool.js'
import type { ToolRenderOptions, ToolResultRenderOptions } from '../services/tools/types.js'

const PREVIEW_LINES = 10

export function renderToolUseMessage(
  input: Partial<ReadToolInput>,
  _options: ToolRenderOptions,
): ReactNode {
  if (!input.file_path) return null

  const parts: string[] = [input.file_path]
  if (input.offset !== undefined) parts.push(`from line ${input.offset}`)
  if (input.limit !== undefined) parts.push(`(${input.limit} lines)`)

  return <Text>{parts.join(' ')}</Text>
}

export function renderToolResultMessage(
  output: ReadToolOutput,
  options: ToolResultRenderOptions,
): ReactNode {
  if (!output.content) {
    return <Text color="gray">(empty file)</Text>
  }

  if (!options.verbose) {
    const noun = output.numLines === 1 ? 'line' : 'lines'
    return (
      <Text>
        Read <Text bold>{output.numLines}</Text> {noun}
        {output.totalLines > output.numLines
          ? ` of ${output.totalLines}`
          : ''
        }
      </Text>
    )
  }

  const lines = output.content.split('\n')
  const preview = lines.slice(0, PREVIEW_LINES)
  const remaining = lines.length - preview.length

  return (
    <Box flexDirection="column">
      {preview.map((line, i) => <Text key={i}>{line}</Text>)}
      {remaining > 0 && (
        <Text color="gray">...{remaining} more lines</Text>
      )}
    </Box>
  )
}

export function isResultTruncated(output: ReadToolOutput): boolean {
  return output.numLines < output.totalLines
}
