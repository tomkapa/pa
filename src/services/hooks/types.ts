import { z } from 'zod'
import type { PermissionBehavior } from '../permissions/types.js'

// ---------------------------------------------------------------------------
// Hook Events — lifecycle points where user hooks can fire
// ---------------------------------------------------------------------------

export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'UserPromptSubmit',
] as const

export type HookEvent = (typeof HOOK_EVENTS)[number]

// ---------------------------------------------------------------------------
// Hook Config — settings.json shape
// ---------------------------------------------------------------------------

export const CommandHookSchema = z.strictObject({
  type: z.literal('command'),
  command: z.string().min(1),
  timeout: z.number().int().positive().optional(),
  statusMessage: z.string().optional(),
})

export type CommandHook = z.infer<typeof CommandHookSchema>

export const HookMatcherSchema = z.strictObject({
  matcher: z.string().optional(),
  hooks: z.array(CommandHookSchema).min(1),
})

export type HookMatcher = z.infer<typeof HookMatcherSchema>

export const HooksSettingsSchema = z
  .record(z.enum(HOOK_EVENTS as unknown as [string, ...string[]]), z.array(HookMatcherSchema))
  .optional()

export type HooksSettings = z.infer<typeof HooksSettingsSchema>

// ---------------------------------------------------------------------------
// Hook Input — JSON sent to hook processes on stdin
// ---------------------------------------------------------------------------

export interface HookInput {
  hook_event_name: HookEvent
  session_id: string
  cwd: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Hook Response — JSON returned by hook processes on stdout
// ---------------------------------------------------------------------------

function contextOnlyOutputSchema<T extends string>(event: T) {
  return z.strictObject({
    hookEventName: z.literal(event),
    additionalContext: z.string().optional(),
  })
}

const PreToolUseOutputSchema = z.strictObject({
  hookEventName: z.literal('PreToolUse'),
  permissionDecision: z.enum(['allow', 'deny', 'ask']).optional(),
  permissionDecisionReason: z.string().optional(),
  updatedInput: z.record(z.unknown()).optional(),
  additionalContext: z.string().optional(),
})

const PostToolUseOutputSchema = contextOnlyOutputSchema('PostToolUse')
const SessionStartOutputSchema = contextOnlyOutputSchema('SessionStart')
const UserPromptSubmitOutputSchema = contextOnlyOutputSchema('UserPromptSubmit')

const HookSpecificOutputSchema = z.discriminatedUnion('hookEventName', [
  PreToolUseOutputSchema,
  PostToolUseOutputSchema,
  SessionStartOutputSchema,
  UserPromptSubmitOutputSchema,
])

export const SyncHookResponseSchema = z.object({
  continue: z.boolean().optional(),
  stopReason: z.string().optional(),
  suppressOutput: z.boolean().optional(),
  decision: z.enum(['approve', 'block']).optional(),
  reason: z.string().optional(),
  hookSpecificOutput: HookSpecificOutputSchema.optional(),
}).passthrough()

export type SyncHookResponse = z.infer<typeof SyncHookResponseSchema>

export type PreToolUseOutput = z.infer<typeof PreToolUseOutputSchema>
export type PostToolUseOutput = z.infer<typeof PostToolUseOutputSchema>
export type SessionStartOutput = z.infer<typeof SessionStartOutputSchema>
export type UserPromptSubmitOutput = z.infer<typeof UserPromptSubmitOutputSchema>

// ---------------------------------------------------------------------------
// Blocking error — returned when a hook vetoes an operation
// ---------------------------------------------------------------------------

export interface HookBlockingError {
  message: string
  command: string
}

// ---------------------------------------------------------------------------
// Hook Result — internal result from one hook execution
// ---------------------------------------------------------------------------

export interface HookResult {
  outcome: 'success' | 'blocking' | 'non_blocking_error' | 'cancelled'
  blockingError?: HookBlockingError
  permissionBehavior?: PermissionBehavior
  hookPermissionDecisionReason?: string
  additionalContext?: string
  updatedInput?: Record<string, unknown>
  preventContinuation?: boolean
  stopReason?: string
}

// ---------------------------------------------------------------------------
// Aggregated Hook Result — yielded to callers from the orchestrator
// ---------------------------------------------------------------------------

export interface AggregatedHookResult {
  blockingError?: HookBlockingError
  permissionBehavior?: PermissionBehavior
  hookPermissionDecisionReason?: string
  additionalContexts?: string[]
  updatedInput?: Record<string, unknown>
  preventContinuation?: boolean
  stopReason?: string
}

// ---------------------------------------------------------------------------
// Default timeout (seconds)
// ---------------------------------------------------------------------------

export const DEFAULT_HOOK_TIMEOUT_SECONDS = 60
