import type { PermissionMode, ToolPermissionContext } from './types.js'

// ---------------------------------------------------------------------------
// Mode Display Configuration
// ---------------------------------------------------------------------------

export interface PermissionModeDisplayConfig {
  readonly title: string
  readonly shortTitle: string
  readonly symbol: string
  readonly color: string
}

export const permissionModeConfig: Record<PermissionMode, PermissionModeDisplayConfig> = {
  default: {
    title: 'Default',
    shortTitle: 'Default',
    symbol: '',
    color: 'white',
  },
  acceptEdits: {
    title: 'Accept edits',
    shortTitle: 'Edits',
    symbol: '\u23F5\u23F5',  // ⏵⏵
    color: 'green',
  },
  plan: {
    title: 'Plan mode',
    shortTitle: 'Plan',
    symbol: '\u23F8',  // ⏸
    color: 'blue',
  },
  bypassPermissions: {
    title: 'Bypass permissions',
    shortTitle: 'Bypass',
    symbol: '\u26A0',  // ⚠
    color: 'red',
  },
}

// ---------------------------------------------------------------------------
// Mode Cycling — pure functions
// ---------------------------------------------------------------------------

/**
 * The mode cycle order. `bypassPermissions` is conditionally included.
 *
 * default → acceptEdits → plan → bypassPermissions* → default
 */
const MODE_CYCLE_ORDER: readonly PermissionMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
]

/**
 * Compute the next permission mode in the cycle.
 *
 * Pure function — no side effects. Skips `bypassPermissions` if unavailable.
 */
export function getNextPermissionMode(ctx: ToolPermissionContext): PermissionMode {
  const currentIndex = MODE_CYCLE_ORDER.indexOf(ctx.mode)
  // If current mode is somehow not in the cycle, start from default
  const startIndex = currentIndex === -1 ? 0 : currentIndex

  // Walk forward through the cycle, skipping unavailable modes
  for (let offset = 1; offset <= MODE_CYCLE_ORDER.length; offset++) {
    const candidate = MODE_CYCLE_ORDER[(startIndex + offset) % MODE_CYCLE_ORDER.length]!
    if (candidate === 'bypassPermissions' && !ctx.isBypassPermissionsModeAvailable) {
      continue
    }
    return candidate
  }

  // Fallback (should never happen — default is always available)
  return 'default'
}

/**
 * Cycle to the next permission mode, returning a new context.
 *
 * Wrapper around `getNextPermissionMode` that produces the updated context.
 */
export function cyclePermissionMode(ctx: ToolPermissionContext): ToolPermissionContext {
  const nextMode = getNextPermissionMode(ctx)
  return { ...ctx, mode: nextMode }
}
