import type { Tool, ToolUseContext } from '../tools/types.js'
import type {
  PermissionDecision,
  PermissionDecisionReason,
  PermissionSuggestion,
  PermissionUpdate,
  ToolPermissionContext,
} from './types.js'
import type { CanUseToolFn } from '../tools/execution/types.js'
import { hasPermissionsToUseTool } from './pipeline.js'

// ---------------------------------------------------------------------------
// ToolUseConfirm — the object pushed onto the confirmation queue
// ---------------------------------------------------------------------------

export interface ToolUseConfirm {
  readonly tool: Tool<unknown, unknown>
  readonly input: unknown
  readonly message: string
  readonly suggestions?: PermissionSuggestion[]
  readonly onAllow: (input: unknown, permissionUpdates: PermissionUpdate[], feedback?: string) => void
  readonly onReject: (feedback?: string) => void
  readonly onAbort: () => void
}

// ---------------------------------------------------------------------------
// Factory — creates a CanUseToolFn that pushes confirms for "ask" decisions
// ---------------------------------------------------------------------------

export function createCanUseToolWithConfirm(
  getPermissionCtx: () => ToolPermissionContext,
  pushConfirm: (confirm: ToolUseConfirm) => void,
): CanUseToolFn {
  return async (
    tool: Tool<unknown, unknown>,
    input: unknown,
    toolUseCtx: ToolUseContext,
  ): Promise<PermissionDecision> => {
    const decision = await hasPermissionsToUseTool(tool, input, getPermissionCtx(), toolUseCtx)

    if (decision.behavior === 'allow' || decision.behavior === 'deny') {
      return decision
    }

    const reason: PermissionDecisionReason = decision.reason

    // behavior === 'ask' → push confirm onto queue, block on Promise
    return new Promise<PermissionDecision>((resolve) => {
      pushConfirm({
        tool,
        input,
        message: decision.message,
        suggestions: decision.suggestions,
        onAllow(updatedInput, _permissionUpdates, _feedback) {
          resolve({
            behavior: 'allow',
            reason,
            updatedInput,
          })
        },
        onReject(feedback) {
          resolve({
            behavior: 'deny',
            reason,
            message: feedback ?? 'User denied',
          })
        },
        onAbort() {
          resolve({
            behavior: 'deny',
            reason,
            message: 'Aborted',
          })
        },
      })
    })
  }
}
