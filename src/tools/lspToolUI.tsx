import { Text } from '../ink.js'
import type { ReactNode } from 'react'
import type { LspToolInput, LspToolOutput } from './lspTool.js'
import type { ToolRenderOptions, ToolResultRenderOptions } from '../services/tools/types.js'

export function renderToolUseMessage(
  input: Partial<LspToolInput>,
  _options: ToolRenderOptions,
): ReactNode {
  if (!input.operation || !input.filePath) return null
  return (
    <Text>
      {input.operation} at {input.filePath}:{input.line ?? '?'}:{input.character ?? '?'}
    </Text>
  )
}

export function renderToolResultMessage(
  output: LspToolOutput,
  options: ToolResultRenderOptions,
): ReactNode {
  if (!options.verbose) {
    const firstLine = output.result.split('\n')[0] ?? ''
    return <Text>{firstLine}</Text>
  }

  return <Text>{output.result}</Text>
}
