import { relative } from 'node:path'
import { Text, Box } from '../ink.js'
import type { ReactNode } from 'react'
import type { GlobToolInput, GlobToolOutput } from './globTool.js'
import type { ToolRenderOptions, ToolResultRenderOptions } from '../services/tools/types.js'

export function renderToolUseMessage(
  input: Partial<GlobToolInput>,
  _options: ToolRenderOptions,
): ReactNode {
  if (!input.pattern) return null
  const pathSuffix = input.path ? ` in ${input.path}` : ''
  return <Text>{input.pattern}{pathSuffix}</Text>
}

export function renderToolResultMessage(
  output: GlobToolOutput,
  options: ToolResultRenderOptions,
): ReactNode {
  if (output.files.length === 0) {
    return <Text color="gray">No files found</Text>
  }

  const suffix = output.truncated ? '+' : ''

  if (!options.verbose) {
    const count = output.files.length
    const noun = count === 1 ? 'file' : 'files'
    return (
      <Text>
        Found <Text bold>{count}{suffix}</Text> {noun}
      </Text>
    )
  }

  const cwd = process.cwd()
  const paths = output.files.map(f => {
    try { return relative(cwd, f) } catch { return f }
  })

  return (
    <Box flexDirection="column">
      {paths.map((p, i) => <Text key={i}>{p}</Text>)}
      {output.truncated && (
        <Text color="gray">(first {output.files.length} results shown)</Text>
      )}
    </Box>
  )
}

export function isResultTruncated(output: GlobToolOutput): boolean {
  return output.truncated
}
