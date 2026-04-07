import { relative } from 'node:path'
import { Text, Box } from '../ink.js'
import type { ReactNode } from 'react'
import type { EditToolInput, EditToolOutput } from './editTool.js'
import type { ToolRenderOptions, ToolResultRenderOptions } from '../services/tools/types.js'

export function userFacingName(input: Partial<EditToolInput>): string {
  if (input.old_string === '') return 'Create'
  if (input.file_path) {
    const action = input.old_string === '' ? 'Create' : 'Edit'
    return `${action}(${input.file_path})`
  }
  return input.old_string === '' ? 'Create' : 'Edit'
}

export function renderToolUseMessage(
  input: Partial<EditToolInput>,
  _options: ToolRenderOptions,
): ReactNode {
  if (!input.file_path) return null

  const action = input.old_string === '' ? 'Create' : 'Edit'
  let filePath: string
  try {
    filePath = relative(process.cwd(), input.file_path)
  } catch {
    filePath = input.file_path
  }

  return (
    <Text>
      {action} <Text bold>{filePath}</Text>
    </Text>
  )
}

export function renderToolResultMessage(
  output: EditToolOutput,
  options: ToolResultRenderOptions,
): ReactNode {
  const { structuredPatch } = output

  let linesAdded = 0
  let linesRemoved = 0
  for (const hunk of structuredPatch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) linesAdded++
      else if (line.startsWith('-')) linesRemoved++
    }
  }

  if (!options.verbose) {
    const parts: string[] = []
    if (linesAdded > 0) parts.push(`+${linesAdded}`)
    if (linesRemoved > 0) parts.push(`-${linesRemoved}`)
    const summary = parts.length > 0 ? ` (${parts.join(', ')})` : ''
    return (
      <Text color="green">
        {output.oldString === '' ? 'Created' : 'Edited'}{summary}
      </Text>
    )
  }

  // Verbose: render diff hunks with colors
  return (
    <Box flexDirection="column">
      {structuredPatch.hunks.map((hunk, hi) => (
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
