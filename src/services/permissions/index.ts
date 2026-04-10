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
export {
  checkBashCommandSecurity,
  matchBashAllowRules,
  matchesRuleContent,
  // Low-level utilities — exported for unit testing
  splitCompoundCommand,
  stripLeadingEnvVars,
  stripSafeWrappers,
  normalizeCommand,
  matchesCommandPrefix,
  detectDangerousPatterns,
  detectHeredoc,
  detectSuspiciousLineContinuation,
  joinLineContinuations,
} from './command-security.js'
export type { BashSecurityResult, BashAllowResult } from './command-security.js'
export { matchWildcardPattern, matchLegacyPrefix, hasWildcard } from './wildcard-matching.js'
export { matchFilePattern, matchFilePatterns } from './file-pattern-matching.js'
export { initializeToolPermissionContext } from './initialize.js'
export type {
  InitializePermissionOptions,
  InitializePermissionResult,
  RuleValidationWarning,
} from './initialize.js'
export {
  loadManagedSettings,
  extractPermissionRules,
  getManagedSettingsPath,
  getManagedConfigRoot,
  SettingsJsonSchema,
} from './managed-settings.js'
export type { SettingsJson, ManagedSettingsResult } from './managed-settings.js'
export {
  extractToolPaths,
  getDangerousPathReason,
  isSensitivePath,
  isWithinDirectory,
  checkReadOnlyPath,
} from './path-validation.js'
export { validatePermissionRule } from './rule-validation.js'
export type { RuleValidationResult } from './rule-validation.js'
export {
  getNextPermissionMode,
  cyclePermissionMode,
  permissionModeConfig,
} from './mode-cycling.js'
export type { PermissionModeDisplayConfig } from './mode-cycling.js'
export { createCanUseToolWithConfirm } from './confirm.js'
export type { ToolUseConfirm } from './confirm.js'
