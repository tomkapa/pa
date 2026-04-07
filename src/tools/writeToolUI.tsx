import { relative } from 'node:path'
import { Text, Box } from '../ink.js'
import type { ReactNode } from 'react'
import type { WriteToolInput, WriteToolOutput } from './writeTool.js'
import type { ToolRenderOptions, ToolResultRenderOptions } from '../services/tools/types.js'

export function renderToolUseMessage(
  input: Partial<WriteToolInput>,
  _options: ToolRenderOptions,
): ReactNode {
  if (!input.file_path) return null

  let filePath: string
  try {
    filePath = relative(process.cwd(), input.file_path)
  } catch {
    filePath = input.file_path
  }

  return <Text bold>{filePath}</Text>
}

export function renderToolResultMessage(
  output: WriteToolOutput,
  options: ToolResultRenderOptions,
): ReactNode {
  const isCreate = output.type === 'create'

  if (!options.verbose) {
    if (isCreate) {
      return <Text color="green">Created</Text>
    }

    let linesAdded = 0
    let linesRemoved = 0
    for (const hunk of output.structuredPatch.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) linesAdded++
        else if (line.startsWith('-')) linesRemoved++
      }
    }
    const parts: string[] = []
    if (linesAdded > 0) parts.push(`+${linesAdded}`)
    if (linesRemoved > 0) parts.push(`-${linesRemoved}`)
    const summary = parts.length > 0 ? ` (${parts.join(', ')})` : ''
    return <Text color="green">Updated{summary}</Text>
  }

  // Verbose: render diff hunks for updates, content preview for creates
  if (isCreate) {
    const lines = output.content.split('\n').slice(0, 20)
    const total = output.content.split('\n').length
    return (
      <Box flexDirection="column">
        {lines.map((line, i) => <Text key={i}>{line}</Text>)}
        {total > 20 && <Text color="gray">...{total - 20} more lines</Text>}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {output.structuredPatch.hunks.map((hunk, hi) => (
        <Box key={hi} flexDirection="column">
          <Text color="cyan">
            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
          </Text>
          {hunk.lines.map((line, li) => {
            const color = line.startsWith('+') ? 'green'
              : line.startsWith('-') ? 'red'
              : 'gray'
            return <Text key={li} color={color}>{line}</Text>
          })}
        </Box>
      ))}
    </Box>
  )
}
