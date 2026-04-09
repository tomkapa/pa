import type {
  ToolPermissionContext,
  PermissionUpdate,
  RulesBySource,
  PermissionRuleSource,
} from './types.js'
import { permissionRuleValueFromString } from './rule-parser.js'
import { matchFilePattern } from './file-pattern-matching.js'
import { FILE_PATTERN_TOOLS } from './tool-classification.js'

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPermissionContext(
  overrides?: Partial<ToolPermissionContext>,
): ToolPermissionContext {
  return {
    mode: 'default',
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    additionalWorkingDirectories: new Map(),
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Immutable update
// ---------------------------------------------------------------------------

export function applyPermissionUpdate(
  ctx: ToolPermissionContext,
  update: PermissionUpdate,
): ToolPermissionContext {
  switch (update.type) {
    case 'setMode': {
      const enteringPlan = update.mode === 'plan' && ctx.mode !== 'plan'
      const leavingPlan = update.mode !== 'plan' && ctx.mode === 'plan'
      return {
        ...ctx,
        mode: update.mode,
        prePlanMode: enteringPlan
          ? ctx.mode
          : leavingPlan
            ? undefined
            : ctx.prePlanMode,
      }
    }

    case 'addRules':
      return {
        ...ctx,
        alwaysAllowRules: addToRulesBySource(ctx.alwaysAllowRules, update.source, update.allow),
        alwaysDenyRules: addToRulesBySource(ctx.alwaysDenyRules, update.source, update.deny),
        alwaysAskRules: addToRulesBySource(ctx.alwaysAskRules, update.source, update.ask),
      }

    case 'replaceRules':
      return {
        ...ctx,
        alwaysAllowRules: replaceInRulesBySource(ctx.alwaysAllowRules, update.source, update.allow),
        alwaysDenyRules: replaceInRulesBySource(ctx.alwaysDenyRules, update.source, update.deny),
        alwaysAskRules: replaceInRulesBySource(ctx.alwaysAskRules, update.source, update.ask),
      }

    case 'removeRules':
      return {
        ...ctx,
        alwaysAllowRules: removeFromRulesBySource(ctx.alwaysAllowRules, update.source, update.allow),
        alwaysDenyRules: removeFromRulesBySource(ctx.alwaysDenyRules, update.source, update.deny),
        alwaysAskRules: removeFromRulesBySource(ctx.alwaysAskRules, update.source, update.ask),
      }

    case 'addDirectories': {
      const merged = new Map(ctx.additionalWorkingDirectories)
      for (const [key, value] of update.directories) {
        merged.set(key, value)
      }
      return { ...ctx, additionalWorkingDirectories: merged }
    }

    case 'removeDirectories': {
      const filtered = new Map(ctx.additionalWorkingDirectories)
      for (const path of update.paths) {
        filtered.delete(path)
      }
      return { ...ctx, additionalWorkingDirectories: filtered }
    }
  }
}

export function applyPermissionUpdates(
  ctx: ToolPermissionContext,
  updates: PermissionUpdate[],
): ToolPermissionContext {
  return updates.reduce(applyPermissionUpdate, ctx)
}

// ---------------------------------------------------------------------------
// Rule matching — does a rule string match a given tool name + content?
// ---------------------------------------------------------------------------

/**
 * Check whether a serialized rule string matches a tool invocation.
 *
 * Matching logic:
 * - Tool-level rule `Read` matches any use of `Read`
 * - Content-specific rule `Bash(git status)` matches only that exact command
 * - MCP server-level rule `mcp__server1` matches any tool from that server
 * - File tools use gitignore-style pattern matching (via `ignore` package)
 *
 * @param cwd - Current working directory (root for file pattern matching).
 *              Required for file tool rules with patterns.
 */
export function matchesRule(
  ruleString: string,
  toolName: string,
  toolContent: string | undefined,
  cwd?: string,
): boolean {
  const parsed = permissionRuleValueFromString(ruleString)

  // MCP server-level matching: rule "mcp__server1" matches "mcp__server1__tool1"
  if (
    parsed.ruleContent === undefined &&
    toolName.startsWith(parsed.toolName + '__')
  ) {
    return true
  }

  // Tool name must match exactly (unless server-level already matched above)
  if (parsed.toolName !== toolName) {
    return false
  }

  // Tool-level rule (no content) matches everything for that tool
  if (parsed.ruleContent === undefined) {
    return true
  }

  // No content to compare against
  if (toolContent === undefined) {
    return false
  }

  // File tools: use gitignore-style pattern matching
  if (FILE_PATTERN_TOOLS.has(toolName) && cwd) {
    return matchFilePattern(toolContent, parsed.ruleContent, cwd)
  }

  // Default: exact match
  return parsed.ruleContent === toolContent
}

// ---------------------------------------------------------------------------
// Find matching rules across all sources
// ---------------------------------------------------------------------------

export function findFirstMatchingRule(
  rulesBySource: RulesBySource,
  toolName: string,
  toolContent: string | undefined,
  cwd?: string,
): { source: PermissionRuleSource; ruleString: string } | undefined {
  for (const [source, rules] of Object.entries(rulesBySource)) {
    if (!rules) continue
    for (const ruleString of rules) {
      if (matchesRule(ruleString, toolName, toolContent, cwd)) {
        return { source: source as PermissionRuleSource, ruleString }
      }
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function addToRulesBySource(
  existing: RulesBySource,
  source: PermissionRuleSource,
  rules: string[] | undefined,
): RulesBySource {
  if (!rules || rules.length === 0) return existing

  const current = existing[source] ?? []
  const unique = new Set(current)
  for (const rule of rules) {
    unique.add(rule)
  }
  return { ...existing, [source]: [...unique] }
}

function replaceInRulesBySource(
  existing: RulesBySource,
  source: PermissionRuleSource,
  rules: string[] | undefined,
): RulesBySource {
  if (rules === undefined) return existing
  return { ...existing, [source]: [...rules] }
}

function removeFromRulesBySource(
  existing: RulesBySource,
  source: PermissionRuleSource,
  rules: string[] | undefined,
): RulesBySource {
  if (!rules || rules.length === 0) return existing

  const current = existing[source]
  if (!current) return existing

  const toRemove = new Set(rules)
  const filtered = current.filter(r => !toRemove.has(r))
  return { ...existing, [source]: filtered }
}
