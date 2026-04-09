// ---------------------------------------------------------------------------
// Mode-Change Message Injection
//
// Detects mid-turn permission mode changes and produces a system-reminder
// user message so the model learns about the switch on the very next API
// call — not one iteration later. This bridges the gap between the
// permission pipeline (which blocks tools reactively) and the attachment
// pipeline (which generates full plan-mode instructions post-tool-execution).
// ---------------------------------------------------------------------------

import type { UserMessage } from '../../types/message.js'
import type { PermissionMode } from '../permissions/types.js'
import { createUserMessage } from '../messages/factory.js'
import { getPlanFilePath } from '../plans/index.js'
import { getSessionId } from '../observability/state.js'

/**
 * Produce a system-reminder user message when the permission mode changes
 * mid-turn. Returns `null` when no message is needed (unknown transition
 * or same mode).
 *
 * The message is intentionally short — it's a mid-turn notification, not
 * the full plan-mode tutorial. The regular `plan_mode` attachment from
 * `getPlanModeAttachments()` delivers the comprehensive instructions on
 * the next post-tool pass.
 */
export function getModeChangeMessage(
  previousMode: PermissionMode,
  currentMode: PermissionMode,
): UserMessage | null {
  if (previousMode === currentMode) return null

  if (currentMode === 'plan') {
    const planFilePath = getPlanFilePath(getSessionId())
    return createUserMessage({
      content: [
        {
          type: 'text',
          text: [
            '<system-reminder>',
            'You have been switched to PLAN MODE by the user.',
            '',
            'In plan mode:',
            '- All file writes and edits are blocked, EXCEPT your plan file',
            '- Bash is blocked — do NOT run shell commands',
            `- Your plan file: ${planFilePath}`,
            '- Only use read-only tools: Read, Glob, Grep',
            '- Write your plan to the plan file',
            '- Call ExitPlanMode when ready for approval',
            '</system-reminder>',
          ].join('\n'),
        },
      ],
      isMeta: true,
    })
  }

  if (previousMode === 'plan') {
    return createUserMessage({
      content: [
        {
          type: 'text',
          text: [
            '<system-reminder>',
            'You have exited PLAN MODE. You can now write and edit files normally.',
            'If you had a plan in progress, it has been preserved on disk.',
            '</system-reminder>',
          ].join('\n'),
        },
      ],
      isMeta: true,
    })
  }

  return null
}
