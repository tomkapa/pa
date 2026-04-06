import type { PermissionMode, PermissionRuleSource, ToolPermissionContext } from './types.js'
import { createPermissionContext, applyPermissionUpdates } from './context.js'
import type { PermissionUpdate } from './types.js'
import { loadManagedSettings, extractPermissionRules } from './managed-settings.js'
import type { SettingsJson } from './managed-settings.js'
import { validatePermissionRule } from './rule-validation.js'
import type { RuleValidationResult } from './rule-validation.js'

export interface InitializePermissionOptions {
  mode?: PermissionMode
  allowedTools?: string[]
  disallowedTools?: string[]
  /** User-level settings (e.g., ~/.claude/settings.json) */
  userSettings?: SettingsJson
  /** Project-level settings (e.g., .claude/settings.json) */
  projectSettings?: SettingsJson
  /** Local settings (e.g., .claude/settings.local.json) */
  localSettings?: SettingsJson
}

export interface RuleValidationWarning {
  source: string
  rule: string
  result: RuleValidationResult
}

export interface InitializePermissionResult {
  context: ToolPermissionContext
  managedSettingsPath: string
  managedSettingsLoaded: boolean
  managedSettingsError?: string
  validationWarnings: RuleValidationWarning[]
}

/**
 * Build the initial ToolPermissionContext from managed settings, CLI flags, and settings files.
 *
 * Settings hierarchy (highest to lowest priority):
 *   policySettings (managed) — organization-enforced, cannot be overridden
 *   flagSettings             — CLI flags (--settings)
 *   localSettings            — .claude/settings.local.json (gitignored)
 *   projectSettings          — .claude/settings.json (shared)
 *   userSettings             — ~/.claude/settings.json (personal)
 *   cliArg                   — --allowed-tools / --disallowed-tools
 */
export function initializeToolPermissionContext(
  options: InitializePermissionOptions = {},
): InitializePermissionResult {
  const updates: PermissionUpdate[] = []
  const validationWarnings: RuleValidationWarning[] = []

  // Load managed settings (highest priority)
  const managed = loadManagedSettings()
  let allowManagedOnly = false

  if (managed.loaded && managed.settings) {
    pushSettingsRules(updates, managed.settings, 'policySettings', validationWarnings)
    allowManagedOnly = managed.settings.allowManagedPermissionRulesOnly === true
  }

  // When allowManagedPermissionRulesOnly is set, skip all non-policy rules
  if (!allowManagedOnly) {
    const settingsSources: [SettingsJson | undefined, PermissionRuleSource][] = [
      [options.userSettings, 'userSettings'],
      [options.projectSettings, 'projectSettings'],
      [options.localSettings, 'localSettings'],
    ]
    for (const [settings, source] of settingsSources) {
      if (settings) {
        pushSettingsRules(updates, settings, source, validationWarnings)
      }
    }

    // CLI --allowed-tools / --disallowed-tools
    if (options.allowedTools && options.allowedTools.length > 0) {
      const validated = validateRuleList(options.allowedTools, 'cliArg', validationWarnings)
      if (validated.length > 0) {
        updates.push({ type: 'addRules', source: 'cliArg', allow: validated })
      }
    }

    if (options.disallowedTools && options.disallowedTools.length > 0) {
      const validated = validateRuleList(options.disallowedTools, 'cliArg', validationWarnings)
      if (validated.length > 0) {
        updates.push({ type: 'addRules', source: 'cliArg', deny: validated })
      }
    }
  }

  if (options.mode) {
    updates.push({ type: 'setMode', mode: options.mode })
  }

  return {
    context: applyPermissionUpdates(createPermissionContext(), updates),
    managedSettingsPath: managed.path,
    managedSettingsLoaded: managed.loaded,
    managedSettingsError: managed.error,
    validationWarnings,
  }
}

// ---------------------------------------------------------------------------
// Internal: validate and filter rules, collecting warnings
// ---------------------------------------------------------------------------

function pushSettingsRules(
  updates: PermissionUpdate[],
  settings: SettingsJson,
  source: PermissionRuleSource,
  warnings: RuleValidationWarning[],
): void {
  const validated = validateAndFilterRules(extractPermissionRules(settings), source, warnings)
  updates.push({
    type: 'addRules',
    source,
    allow: validated.allow.length > 0 ? validated.allow : undefined,
    deny: validated.deny.length > 0 ? validated.deny : undefined,
    ask: validated.ask.length > 0 ? validated.ask : undefined,
  })
}

function validateAndFilterRules(
  rules: { allow: string[]; deny: string[]; ask: string[] },
  source: string,
  warnings: RuleValidationWarning[],
): { allow: string[]; deny: string[]; ask: string[] } {
  return {
    allow: validateRuleList(rules.allow, source, warnings),
    deny: validateRuleList(rules.deny, source, warnings),
    ask: validateRuleList(rules.ask, source, warnings),
  }
}

function validateRuleList(
  rules: string[],
  source: string,
  warnings: RuleValidationWarning[],
): string[] {
  const valid: string[] = []
  for (const rule of rules) {
    const result = validatePermissionRule(rule)
    if (result.valid) {
      valid.push(rule)
    } else {
      warnings.push({ source, rule, result })
    }
  }
  return valid
}
