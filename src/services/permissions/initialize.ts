import type { PermissionMode, ToolPermissionContext } from './types.js'
import { createPermissionContext, applyPermissionUpdates } from './context.js'
import type { PermissionUpdate } from './types.js'

export interface InitializePermissionOptions {
  mode?: PermissionMode
  allowedTools?: string[]
  disallowedTools?: string[]
}

/**
 * Build the initial ToolPermissionContext from CLI flags and settings.
 *
 * For v1: reads CLI flags only. Settings file loading is a future enhancement.
 */
export function initializeToolPermissionContext(
  options: InitializePermissionOptions = {},
): ToolPermissionContext {
  const updates: PermissionUpdate[] = []

  if (options.mode) {
    updates.push({ type: 'setMode', mode: options.mode })
  }

  if (options.allowedTools && options.allowedTools.length > 0) {
    updates.push({
      type: 'addRules',
      source: 'cliArg',
      allow: options.allowedTools,
    })
  }

  if (options.disallowedTools && options.disallowedTools.length > 0) {
    updates.push({
      type: 'addRules',
      source: 'cliArg',
      deny: options.disallowedTools,
    })
  }

  return applyPermissionUpdates(createPermissionContext(), updates)
}
