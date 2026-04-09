// ---------------------------------------------------------------------------
// Permission Types — standalone module, zero internal dependencies
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Permission Modes — user-facing presets
// ---------------------------------------------------------------------------

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export const PERMISSION_MODES: readonly PermissionMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
] as const

// ---------------------------------------------------------------------------
// Permission Behaviors — the three possible outcomes
// ---------------------------------------------------------------------------

export type PermissionBehavior = 'allow' | 'deny' | 'ask'

// ---------------------------------------------------------------------------
// Rule Sources — ordered by precedence (highest first)
// ---------------------------------------------------------------------------

export type PermissionRuleSource =
  | 'policySettings'
  | 'flagSettings'
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'cliArg'
  | 'session'
  | 'command'

export const RULE_SOURCE_PRECEDENCE: readonly PermissionRuleSource[] = [
  'policySettings',
  'flagSettings',
  'userSettings',
  'projectSettings',
  'localSettings',
  'cliArg',
  'session',
  'command',
] as const

// ---------------------------------------------------------------------------
// Rule Value — identifies which tool (and optionally which content)
// ---------------------------------------------------------------------------

export interface PermissionRuleValue {
  toolName: string
  ruleContent?: string
}

// ---------------------------------------------------------------------------
// Rule — a single permission rule from a specific source
// ---------------------------------------------------------------------------

export interface PermissionRule {
  source: PermissionRuleSource
  ruleBehavior: PermissionBehavior
  ruleValue: PermissionRuleValue
}

// ---------------------------------------------------------------------------
// Rules by source — stored as serialized strings keyed by source
// ---------------------------------------------------------------------------

export type RulesBySource = Partial<Record<PermissionRuleSource, string[]>>

// ---------------------------------------------------------------------------
// Decision Reasons — why a decision was made
// ---------------------------------------------------------------------------

export type PermissionDecisionReason =
  | { type: 'rule'; rule: PermissionRule }
  | { type: 'mode'; mode: PermissionMode }
  | { type: 'safetyCheck'; description: string }
  | { type: 'toolSpecific'; description: string }
  | { type: 'default' }

// ---------------------------------------------------------------------------
// Permission Decision — the final output of the pipeline
// ---------------------------------------------------------------------------

export type PermissionDecision =
  | { behavior: 'allow'; reason: PermissionDecisionReason; updatedInput: unknown }
  | { behavior: 'deny'; reason: PermissionDecisionReason; message: string }
  | {
      behavior: 'ask'
      reason: PermissionDecisionReason
      message: string
      suggestions?: PermissionSuggestion[]
    }

// ---------------------------------------------------------------------------
// Permission Result — what tool.checkPermissions() returns (includes passthrough)
// ---------------------------------------------------------------------------

export type PermissionResult =
  | { behavior: 'allow'; updatedInput: unknown }
  | { behavior: 'deny'; reason: PermissionDecisionReason; message: string }
  | {
      behavior: 'ask'
      reason: PermissionDecisionReason
      message: string
      isBypassImmune?: boolean
      suggestions?: PermissionSuggestion[]
    }
  | { behavior: 'passthrough' }

// ---------------------------------------------------------------------------
// Permission Suggestion — "always allow" options shown in the ask dialog
// ---------------------------------------------------------------------------

export interface PermissionSuggestion {
  ruleValue: string
  description: string
}

// ---------------------------------------------------------------------------
// Additional Working Directory — for multi-root workspaces
// ---------------------------------------------------------------------------

export interface AdditionalWorkingDirectory {
  path: string
  readOnly: boolean
}

// ---------------------------------------------------------------------------
// Tool Permission Context — immutable in-memory permission state
// ---------------------------------------------------------------------------

export interface ToolPermissionContext {
  readonly mode: PermissionMode
  /** Saved mode before entering plan mode, restored on exit. */
  readonly prePlanMode?: PermissionMode
  readonly alwaysAllowRules: RulesBySource
  readonly alwaysDenyRules: RulesBySource
  readonly alwaysAskRules: RulesBySource
  readonly additionalWorkingDirectories: ReadonlyMap<string, AdditionalWorkingDirectory>
  readonly isBypassPermissionsModeAvailable: boolean
}

// ---------------------------------------------------------------------------
// Permission Updates — discriminated union for immutable context updates
// ---------------------------------------------------------------------------

export type PermissionUpdate =
  | {
      type: 'addRules'
      source: PermissionRuleSource
      allow?: string[]
      deny?: string[]
      ask?: string[]
    }
  | {
      type: 'replaceRules'
      source: PermissionRuleSource
      allow?: string[]
      deny?: string[]
      ask?: string[]
    }
  | {
      type: 'removeRules'
      source: PermissionRuleSource
      allow?: string[]
      deny?: string[]
      ask?: string[]
    }
  | { type: 'setMode'; mode: PermissionMode }
  | {
      type: 'addDirectories'
      directories: Map<string, AdditionalWorkingDirectory>
    }
  | { type: 'removeDirectories'; paths: string[] }
