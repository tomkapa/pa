import { z } from 'zod'
import type { ToolDef, ToolResultBlockParam } from '../services/tools/types.js'
import { applyPermissionUpdate } from '../services/permissions/context.js'
import { getPlanFilePath, getPlan } from '../services/plans/index.js'
import { getSessionId } from '../services/observability/state.js'
import { logForDebugging } from '../services/observability/debug.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExitPlanModeInput = Record<string, never>

export interface ExitPlanModeOutput {
  plan: string | null
  filePath: string
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function exitPlanModeToolDef(): ToolDef<ExitPlanModeInput, ExitPlanModeOutput> {
  return {
    name: 'ExitPlanMode',
    shouldDefer: true,
    maxResultSizeChars: 50_000,

    get inputSchema() {
      return z.strictObject({})
    },

    isReadOnly: () => false,
    isConcurrencySafe: () => false,

    async validateInput(_input, context) {
      const permCtx = context.getPermissionContext?.()
      if (permCtx?.mode !== 'plan') {
        logForDebugging(
          `exit_plan_mode_called_outside_plan: mode=${permCtx?.mode ?? 'unknown'}`,
          { level: 'warn' },
        )
        return {
          result: false,
          message:
            'You are not in plan mode. This tool is only for exiting plan mode after writing a plan. ' +
            'If your plan was already approved, continue with implementation.',
        }
      }
      return { result: true }
    },

    async checkPermissions() {
      return {
        behavior: 'ask' as const,
        reason: { type: 'toolSpecific' as const, description: 'Model-initiated plan mode exit' },
        message: 'Exit plan mode?',
        // Must bypass plan mode's write-deny at pipeline step 6 — ExitPlanMode
        // is non-read-only (it mutates permission state) but must be callable
        // from within plan mode. isBypassImmune short-circuits at step 3.
        isBypassImmune: true,
      }
    },

    async prompt() {
      return (
        'Exit plan mode and present your plan to the user for approval. ' +
        'Use only after you have finished writing your plan to the plan file.\n\n' +
        'If the user rejects your plan, you will remain in plan mode and can iterate ' +
        'on the plan file before calling ExitPlanMode again.'
      )
    },

    async description() {
      return 'Exit plan mode'
    },

    userFacingName() {
      return 'ExitPlanMode'
    },

    async call(_input, context) {
      if (!context.setPermissionContext) {
        throw new Error('ExitPlanMode requires setPermissionContext on ToolUseContext')
      }
      const sessionId = getSessionId()
      const filePath = getPlanFilePath(sessionId)
      const plan = getPlan(sessionId)

      context.setPermissionContext(prev => {
        if (prev.mode !== 'plan') return prev
        return applyPermissionUpdate(prev, {
          type: 'setMode',
          mode: prev.prePlanMode ?? 'default',
        })
      })

      logForDebugging(
        `plan_exit: planLengthChars=${plan?.length ?? 0}, planWasEmpty=${!plan || plan.trim() === ''}`,
        { level: 'info' },
      )

      return { data: { plan, filePath } }
    },

    mapToolResultToToolResultBlockParam(
      output: ExitPlanModeOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      if (!output.plan || output.plan.trim() === '') {
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUseID,
          content: 'User has approved exiting plan mode. You can now proceed.',
        }
      }
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: `User has approved your plan. You can now start coding.

Your plan has been saved to: ${output.filePath}
You can refer back to it if needed during implementation.

## Approved Plan:
${output.plan}`,
      }
    },
  }
}
