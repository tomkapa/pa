import { Text, Box } from '../ink.js'
import type { ReactNode } from 'react'
import type { GrepToolInput, GrepToolOutput } from './grepTool.js'
import type { ToolRenderOptions, ToolResultRenderOptions } from '../services/tools/types.js'

export function renderToolUseMessage(
  input: Partial<GrepToolInput>,
  _options: ToolRenderOptions,
): ReactNode {
  if (!input.pattern) return null

  const parts: string[] = [`"${input.pattern}"`]
  if (input.path) parts.push(`in ${input.path}`)
  if (input.glob) parts.push(`(${input.glob})`)
  if (input.type) parts.push(`(type:${input.type})`)
  if (input.output_mode && input.output_mode !== 'files_with_matches') {
    parts.push(`[${input.output_mode}]`)
  }

  return <Text>{parts.join(' ')}</Text>
}

export function renderToolResultMessage(
  output: GrepToolOutput,
  options: ToolResultRenderOptions,
): ReactNode {
  if (!output.content) {
    return <Text color="gray">No matches found</Text>
  }

  if (!options.verbose) {
    const mode = output.mode
    if (mode === 'files_with_matches' || mode === 'count') {
      const lines = output.content.split('\n').filter(Boolean)
      const suffix = output.truncated ? '+' : ''
      const noun = mode === 'count' ? 'files with matches' : 'files'
      return (
        <Text>
          Found <Text bold>{lines.length}{suffix}</Text> {noun}
        </Text>
      )
    }
    // content mode — show first few lines
    const allLines = output.content.split('\n')
    const preview = allLines.slice(0, 5)
    const remaining = allLines.length - preview.length
    return (
      <Box flexDirection="column">
        {preview.map((line, i) => <Text key={i}>{line}</Text>)}
        {remaining > 0 && (
          <Text color="gray">...and {remaining} more lines</Text>
        )}
      </Box>
    )
  }

  const lines = output.content.split('\n')
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => <Text key={i}>{line}</Text>)}
      {output.truncated && (
        <Text color="gray">
          (showing {output.appliedLimit} of {output.totalLines} results)
        </Text>
      )}
    </Box>
  )
}

export function isResultTruncated(output: GrepToolOutput): boolean {
  return output.truncated
}
