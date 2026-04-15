import { z } from 'zod'
import type { ToolDef, ToolResultBlockParam } from '../services/tools/types.js'
import { applyPermissionUpdate } from '../services/permissions/context.js'
import { getPlanFilePath } from '../services/plans/index.js'
import { getSessionId } from '../services/observability/state.js'
import { logForDebugging } from '../services/observability/debug.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EnterPlanModeInput = Record<string, never>

export interface EnterPlanModeOutput {
  entered: boolean
  planFilePath: string
  fromMode: string
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function enterPlanModeToolDef(): ToolDef<EnterPlanModeInput, EnterPlanModeOutput> {
  return {
    name: 'EnterPlanMode',
    shouldDefer: true,
    maxResultSizeChars: 2_000,

    get inputSchema() {
      return z.strictObject({})
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => false,

    async checkPermissions() {
      return {
        behavior: 'ask' as const,
        reason: { type: 'toolSpecific' as const, description: 'Model-initiated plan mode entry' },
        message: 'Enter plan mode?',
        isBypassImmune: true,
      }
    },

    async prompt() {
      return (
        'Enter plan mode for complex tasks requiring exploration and design before implementation. ' +
        'Use when the task involves:\n' +
        '- Architectural decisions or multiple valid approaches\n' +
        '- Multi-file changes where order and dependencies matter\n' +
        '- Unclear requirements that need codebase exploration first\n\n' +
        'Do NOT use for:\n' +
        '- Typo fixes or single-line changes\n' +
        '- Pure research or "what does this code do" questions\n' +
        '- Tasks where the path forward is obvious'
      )
    },

    async description() {
      return 'Enter plan mode'
    },

    userFacingName() {
      return 'EnterPlanMode'
    },

    async call(_input, context) {
      if (!context.setPermissionContext) {
        throw new Error('EnterPlanMode requires setPermissionContext on ToolUseContext')
      }
      const currentMode = context.getPermissionContext?.()?.mode ?? 'default'

      context.setPermissionContext(prev =>
        applyPermissionUpdate(prev, { type: 'setMode', mode: 'plan' }),
      )

      const planFilePath = getPlanFilePath(getSessionId())

      logForDebugging(`plan_enter: fromMode=${currentMode}`, { level: 'info' })

      return {
        data: { entered: true, planFilePath, fromMode: currentMode },
      }
    },

    mapToolResultToToolResultBlockParam(
      output: EnterPlanModeOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: `Entered plan mode.

Your plan file: ${output.planFilePath}

In plan mode you should:
1. Explore the codebase with Read, Glob, Grep (read-only tools ONLY)
2. Design an implementation approach
3. Write your plan to the plan file above using the Write tool
4. Call ExitPlanMode when the plan is ready for user approval

DO NOT write or edit any files other than the plan file.
DO NOT use Bash — shell commands are blocked in plan mode.
This is a read-only exploration phase.`,
      }
    },
  }
}
