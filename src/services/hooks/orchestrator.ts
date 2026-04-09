import { getHooksForEvent, filterByMatcher } from './config.js'
import { execCommandHook } from './executor.js'
import {
  SyncHookResponseSchema,
  type HookInput,
  type HookResult,
  type AggregatedHookResult,
  type CommandHook,
} from './types.js'

// Singleton — avoids allocating a new AbortController per invocation
const NEVER_ABORTED_SIGNAL = new AbortController().signal

// ---------------------------------------------------------------------------
// Result Processing — exit code + stdout → HookResult
// ---------------------------------------------------------------------------

export function processHookResult(
  hook: CommandHook,
  stdout: string,
  stderr: string,
  exitCode: number,
): HookResult {
  // Exit code 2 = blocking error (stderr shown to model)
  if (exitCode === 2) {
    return {
      outcome: 'blocking',
      blockingError: {
        message: stderr || 'Blocked by hook',
        command: hook.command,
      },
    }
  }

  // Non-zero, non-2 = non-blocking error (operation continues)
  if (exitCode !== 0) {
    return { outcome: 'non_blocking_error' }
  }

  // Exit 0 — try to parse stdout as JSON
  if (!stdout.startsWith('{')) {
    return { outcome: 'success' }
  }

  let rawJson: unknown
  try {
    rawJson = JSON.parse(stdout)
  } catch {
    return { outcome: 'success' }
  }

  const parseResult = SyncHookResponseSchema.safeParse(rawJson)
  if (!parseResult.success) {
    return { outcome: 'success' }
  }

  const json = parseResult.data
  const result: HookResult = { outcome: 'success' }

  // Handle continue: false
  if (json.continue === false) {
    result.preventContinuation = true
    result.stopReason = json.stopReason
  }

  // Handle top-level decision shorthand
  if (json.decision === 'block') {
    result.outcome = 'blocking'
    result.permissionBehavior = 'deny'
    result.blockingError = {
      message: json.reason ?? 'Blocked by hook',
      command: hook.command,
    }
  } else if (json.decision === 'approve') {
    result.permissionBehavior = 'allow'
  }

  // Handle hookSpecificOutput (overrides top-level if both present)
  if (json.hookSpecificOutput) {
    const specific = json.hookSpecificOutput
    if (specific.hookEventName === 'PreToolUse') {
      if (specific.permissionDecision === 'deny') {
        result.outcome = 'blocking'
        result.permissionBehavior = 'deny'
        result.blockingError = {
          message:
            specific.permissionDecisionReason ??
            json.reason ??
            'Blocked by hook',
          command: hook.command,
        }
      } else if (specific.permissionDecision === 'allow') {
        result.permissionBehavior = 'allow'
      } else if (specific.permissionDecision === 'ask') {
        result.permissionBehavior = 'ask'
      }
      result.hookPermissionDecisionReason = specific.permissionDecisionReason
      result.updatedInput = specific.updatedInput
      result.additionalContext = specific.additionalContext
    } else {
      // PostToolUse, SessionStart, UserPromptSubmit — all share the same shape
      result.additionalContext = specific.additionalContext
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Hook Orchestrator — async generator that runs hooks in parallel
// ---------------------------------------------------------------------------

export async function* executeHooks(params: {
  hookInput: HookInput
  matchQuery?: string
  signal?: AbortSignal
}): AsyncGenerator<AggregatedHookResult> {
  const { hookInput, matchQuery, signal } = params
  const hookEvent = hookInput.hook_event_name

  // 1. Load and filter hooks
  const matchers = getHooksForEvent(hookEvent)
  const filtered = filterByMatcher(matchers, matchQuery)
  const hooks = filtered.flatMap(m => m.hooks)

  if (hooks.length === 0) return

  // 2. Serialize hook input once (shared across all hooks)
  const jsonInput = JSON.stringify(hookInput)
  const effectiveSignal = signal ?? NEVER_ABORTED_SIGNAL

  // 3. Run all hooks in parallel — each promise is internally caught,
  //    so they never reject; Promise.all is safe here.
  const results = await Promise.all(
    hooks.map(async (hook): Promise<HookResult> => {
      try {
        const { stdout, stderr, status } = await execCommandHook(
          hook,
          jsonInput,
          effectiveSignal,
        )
        return processHookResult(hook, stdout, stderr, status)
      } catch {
        return { outcome: 'non_blocking_error' as const }
      }
    }),
  )

  // 4. Permission precedence tracking: deny > ask > allow
  let permissionBehavior: HookResult['permissionBehavior']

  for (const result of results) {
    if (result.blockingError) {
      yield { blockingError: result.blockingError }
    }

    if (result.additionalContext) {
      yield { additionalContexts: [result.additionalContext] }
    }

    // Yield updated input (for passthrough — no permission decision)
    if (result.updatedInput && result.permissionBehavior === undefined) {
      yield { updatedInput: result.updatedInput }
    }

    // Permission precedence: deny > ask > allow
    if (result.permissionBehavior) {
      switch (result.permissionBehavior) {
        case 'deny':
          permissionBehavior = 'deny'
          break
        case 'ask':
          if (permissionBehavior !== 'deny') permissionBehavior = 'ask'
          break
        case 'allow':
          if (!permissionBehavior) permissionBehavior = 'allow'
          break
      }
      yield {
        permissionBehavior,
        hookPermissionDecisionReason: result.hookPermissionDecisionReason,
        updatedInput: result.updatedInput,
      }
    }

    if (result.preventContinuation) {
      yield { preventContinuation: true, stopReason: result.stopReason }
    }
  }
}
