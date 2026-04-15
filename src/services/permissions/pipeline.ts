import type { Tool, ToolUseContext } from '../tools/types.js'
import type {
  ToolPermissionContext,
  PermissionDecision,
} from './types.js'
import { findFirstMatchingRule } from './context.js'
import { isFilesystemCommand } from './safety.js'
import { checkBashCommandSecurity, matchBashAllowRules } from './command-security.js'
import { isSessionPlanFile } from '../plans/index.js'
import { getAutoMemoryDir, isAutoMemoryPath } from '../auto-memory/index.js'
import { expandPath } from '../../utils/expandPath.js'
import {
  extractToolPaths,
  checkReadOnlyPath,
} from './path-validation.js'

/**
 * The permission pipeline — decides whether a tool can execute.
 *
 * Cascade (most-restrictive to most-permissive):
 * 1. Deny rules → instant deny
 * 2. Ask rules → instant ask (bypass-immune)
 * 3. Tool checkPermissions() → deny or bypass-immune ask short-circuits
 * 4. acceptEdits mode → auto-allow file ops and filesystem commands
 * 5. bypassPermissions mode → auto-allow everything remaining
 * 6. plan mode → allow reads, deny writes
 * 7. Read-only auto-allow → auto-approve read-only tools within CWD
 * 8. Allow rules → auto-allow
 * 9. Tool's non-bypass-immune ask (if any) → surface now
 * 10. Default → ask
 */
export async function hasPermissionsToUseTool(
  tool: Tool<unknown, unknown>,
  input: unknown,
  permissionCtx: ToolPermissionContext,
  toolUseCtx: ToolUseContext,
): Promise<PermissionDecision> {
  const toolName = tool.name
  const toolContent = extractToolContent(tool, input)
  const cwd = process.cwd()

  const isBashTool = toolName === 'Bash'

  // 1. Deny rules (highest priority — always win)
  // For Bash: compound-aware deny with env var stripping and prefix matching
  // (subsumes the generic deny check, so we skip findFirstMatchingRule for Bash)
  if (isBashTool && typeof toolContent === 'string') {
    const bashResult = checkBashCommandSecurity(
      toolContent,
      toolName,
      permissionCtx.alwaysDenyRules,
    )
    if (bashResult.behavior === 'deny') {
      return {
        behavior: 'deny',
        reason: {
          type: 'rule',
          rule: {
            source: bashResult.matchedSource ?? 'userSettings',
            ruleBehavior: 'deny',
            ruleValue: { toolName, ruleContent: toolContent },
          },
        },
        message: bashResult.reason ?? `Denied by rule: ${bashResult.matchedRule}`,
      }
    }
    if (bashResult.behavior === 'ask') {
      return {
        behavior: 'ask',
        reason: { type: 'safetyCheck', description: bashResult.reason ?? 'Bash security check' },
        message: bashResult.reason ?? 'Command requires manual review',
      }
    }
  } else {
    const denyMatch = findFirstMatchingRule(permissionCtx.alwaysDenyRules, toolName, toolContent, cwd)
    if (denyMatch) {
      return {
        behavior: 'deny',
        reason: {
          type: 'rule',
          rule: {
            source: denyMatch.source,
            ruleBehavior: 'deny',
            ruleValue: { toolName, ruleContent: toolContent },
          },
        },
        message: `Denied by ${denyMatch.source} rule: ${denyMatch.ruleString}`,
      }
    }
  }

  // 1.5. Internal editable paths — plan files bypass all further checks.
  // Only the CURRENT session's plan file qualifies; other plan files are
  // treated normally. Deny rules (above) still win over this carve-out.
  // Short-circuit: skip the filesystem work when not in plan mode.
  if (
    permissionCtx.mode === 'plan' &&
    (toolName === 'Write' || toolName === 'Edit')
  ) {
    const filePath = extractToolContent(tool, input)
    if (filePath && isSessionPlanFile(expandPath(filePath))) {
      return {
        behavior: 'allow',
        reason: { type: 'toolSpecific', description: 'Session plan file is always writable' },
        updatedInput: input,
      }
    }
  }

  // 1.6. Auto-memory directory — Write/Edit to the memory directory are
  //       auto-approved so the model can save memories without prompting.
  //       Deny rules (step 1) still win over this carve-out.
  if (toolName === 'Write' || toolName === 'Edit') {
    const filePath = extractToolContent(tool, input)
    if (filePath) {
      const memoryDir = getAutoMemoryDir(cwd)
      if (isAutoMemoryPath(expandPath(filePath), memoryDir)) {
        return {
          behavior: 'allow',
          reason: { type: 'toolSpecific', description: 'Auto-memory directory is auto-approved' },
          updatedInput: input,
        }
      }
    }
  }

  // 2. Ask rules (bypass-immune — force prompt even in bypassPermissions)
  const askMatch = findFirstMatchingRule(permissionCtx.alwaysAskRules, toolName, toolContent, cwd)
  if (askMatch) {
    return {
      behavior: 'ask',
      reason: {
        type: 'rule',
        rule: {
          source: askMatch.source,
          ruleBehavior: 'ask',
          ruleValue: { toolName, ruleContent: toolContent },
        },
      },
      message: `Requires approval (${askMatch.source} rule): ${askMatch.ruleString}`,
    }
  }

  // 3. Tool-specific permission check
  const toolResult = await tool.checkPermissions(input, toolUseCtx)

  if (toolResult.behavior === 'deny') {
    return {
      behavior: 'deny',
      reason: toolResult.reason,
      message: toolResult.message,
    }
  }

  if (toolResult.behavior === 'ask' && toolResult.isBypassImmune) {
    return {
      behavior: 'ask',
      reason: toolResult.reason,
      message: toolResult.message,
      suggestions: toolResult.suggestions,
    }
  }

  const toolAsk = toolResult.behavior === 'ask' ? toolResult : null

  // 4. acceptEdits mode auto-allows file operations
  if (permissionCtx.mode === 'acceptEdits' && isAcceptEditsAutoAllowed(tool, input)) {
    return {
      behavior: 'allow',
      reason: { type: 'mode', mode: 'acceptEdits' },
      updatedInput: input,
    }
  }

  // 5. bypassPermissions mode auto-allows everything remaining
  if (permissionCtx.mode === 'bypassPermissions') {
    return {
      behavior: 'allow',
      reason: { type: 'mode', mode: 'bypassPermissions' },
      updatedInput: input,
    }
  }

  // 6. plan mode: allow reads, deny writes
  if (permissionCtx.mode === 'plan') {
    if (tool.isReadOnly(input)) {
      return {
        behavior: 'allow',
        reason: { type: 'mode', mode: 'plan' },
        updatedInput: input,
      }
    }
    return {
      behavior: 'deny',
      reason: { type: 'mode', mode: 'plan' },
      message: `Write operations are not allowed in plan mode: ${toolName}`,
    }
  }

  // 7. Read-only auto-allow — auto-approve read-only tools within CWD,
  //    but prompt for dangerous paths, sensitive files, or paths outside CWD.
  if (tool.isReadOnly(input)) {
    const paths = extractToolPaths(input)

    if (paths.length === 0) {
      return {
        behavior: 'allow',
        reason: { type: 'toolSpecific', description: 'Read-only tool with no filesystem paths' },
        updatedInput: input,
      }
    }

    // Single pass: dangerous → sensitive → CWD boundary (defense-in-depth order)
    let allWithinCwd = true
    for (const rawPath of paths) {
      const check = checkReadOnlyPath(rawPath, cwd)
      if (check?.type === 'dangerous') {
        return {
          behavior: 'ask',
          reason: { type: 'safetyCheck', description: check.reason },
          message: `${toolName} targets a potentially dangerous path: ${check.reason}`,
        }
      }
      if (check?.type === 'sensitive') {
        return {
          behavior: 'ask',
          reason: { type: 'safetyCheck', description: 'Sensitive file path' },
          message: `${toolName} targets a sensitive file. Allow?`,
        }
      }
      if (check?.type === 'outside-cwd') {
        allWithinCwd = false
      }
    }

    if (allWithinCwd) {
      return {
        behavior: 'allow',
        reason: { type: 'toolSpecific', description: 'Read-only tool within project directory' },
        updatedInput: input,
      }
    }

    // Outside CWD — fall through to allow rules / default ask
  }

  // 8. Allow rules
  // For Bash: compound-aware matching with prefix word boundaries
  if (isBashTool && typeof toolContent === 'string') {
    const bashAllow = matchBashAllowRules(
      toolContent,
      toolName,
      permissionCtx.alwaysAllowRules,
    )
    if (bashAllow.matched) {
      return {
        behavior: 'allow',
        reason: {
          type: 'rule',
          rule: {
            source: bashAllow.source ?? 'session',
            ruleBehavior: 'allow',
            ruleValue: { toolName, ruleContent: toolContent },
          },
        },
        updatedInput: input,
      }
    }
  } else {
    const allowMatch = findFirstMatchingRule(permissionCtx.alwaysAllowRules, toolName, toolContent, cwd)
    if (allowMatch) {
      return {
        behavior: 'allow',
        reason: {
          type: 'rule',
          rule: {
            source: allowMatch.source,
            ruleBehavior: 'allow',
            ruleValue: { toolName, ruleContent: toolContent },
          },
        },
        updatedInput: input,
      }
    }
  }

  // 9. Surface deferred tool ask
  if (toolAsk) {
    return {
      behavior: 'ask',
      reason: toolAsk.reason,
      message: toolAsk.message,
      suggestions: toolAsk.suggestions,
    }
  }

  // 10. Default → ask
  return {
    behavior: 'ask',
    reason: { type: 'default' },
    message: `Allow ${toolName}?`,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractToolContent(_tool: Tool<unknown, unknown>, input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  if (typeof input.command === 'string') return input.command
  if (typeof input.file_path === 'string') return input.file_path
  return undefined
}

function isAcceptEditsAutoAllowed(tool: Tool<unknown, unknown>, input: unknown): boolean {
  if (tool.name === 'Write' || tool.name === 'Edit') return true

  if (tool.name === 'Bash' && isRecord(input) && typeof input.command === 'string') {
    return isFilesystemCommand(input.command)
  }

  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
