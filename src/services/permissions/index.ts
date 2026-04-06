export type {
  PermissionMode,
  PermissionBehavior,
  PermissionRuleValue,
  PermissionRule,
  PermissionRuleSource,
  PermissionDecision,
  PermissionResult,
  PermissionDecisionReason,
  PermissionSuggestion,
  ToolPermissionContext,
  PermissionUpdate,
  RulesBySource,
  AdditionalWorkingDirectory,
} from './types.js'

export { PERMISSION_MODES, RULE_SOURCE_PRECEDENCE } from './types.js'
export { permissionRuleValueFromString, permissionRuleValueToString } from './rule-parser.js'
export {
  createPermissionContext,
  applyPermissionUpdate,
  applyPermissionUpdates,
  matchesRule,
  findFirstMatchingRule,
} from './context.js'
export { hasPermissionsToUseTool } from './pipeline.js'
export { referencesProtectedPath, isFilesystemCommand, checkProtectedPath } from './safety.js'
export { initializeToolPermissionContext } from './initialize.js'
export type { InitializePermissionOptions } from './initialize.js'
export {
  getNextPermissionMode,
  cyclePermissionMode,
  permissionModeConfig,
} from './mode-cycling.js'
export type { PermissionModeDisplayConfig } from './mode-cycling.js'
export { createCanUseToolWithConfirm } from './confirm.js'
export type { ToolUseConfirm } from './confirm.js'
