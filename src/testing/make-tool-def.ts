import { z } from 'zod'
import type { ToolDef, ToolUseContext } from '../services/tools/types.js'
import type { PermissionResult } from '../services/permissions/types.js'

export function makeToolDef(
  overrides?: Partial<ToolDef<{ value: string }, string>> & {
    checkPermissions?: (
      input: { value: string },
      ctx: ToolUseContext,
    ) => Promise<PermissionResult>
  },
): ToolDef<{ value: string }, string> {
  return {
    name: 'TestTool',
    maxResultSizeChars: 50_000,
    inputSchema: z.strictObject({ value: z.string() }),
    async call(input) {
      return { data: input.value }
    },
    async prompt() {
      return 'A test tool.'
    },
    async description(input) {
      return `Test: ${input.value}`
    },
    mapToolResultToToolResultBlockParam(output, toolUseID) {
      return { type: 'tool_result' as const, tool_use_id: toolUseID, content: output }
    },
    ...overrides,
  }
}

export function makeBashToolDef(
  overrides?: Partial<ToolDef<{ value: string }, string>>,
): ToolDef<{ value: string }, string> {
  return makeToolDef({
    name: 'Bash',
    userFacingName: (input) => input.value ? `Bash(${input.value})` : 'Bash',
    ...overrides,
  })
}
