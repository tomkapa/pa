import { executeHooks } from './orchestrator.js'
import { getSessionId } from '../observability/state.js'
import type { AggregatedHookResult } from './types.js'

// ---------------------------------------------------------------------------
// PreToolUse — called BEFORE running a tool
// ---------------------------------------------------------------------------

export async function* executePreToolHooks(
  toolName: string,
  toolUseID: string,
  toolInput: unknown,
  signal?: AbortSignal,
): AsyncGenerator<AggregatedHookResult> {
  yield* executeHooks({
    hookInput: {
      hook_event_name: 'PreToolUse',
      session_id: getSessionId(),
      cwd: process.cwd(),
      tool_name: toolName,
      tool_input: toolInput,
      tool_use_id: toolUseID,
    },
    matchQuery: toolName,
    signal,
  })
}

// ---------------------------------------------------------------------------
// PostToolUse — called AFTER successful tool execution
// ---------------------------------------------------------------------------

export async function* executePostToolHooks(
  toolName: string,
  toolUseID: string,
  toolInput: unknown,
  toolResponse: unknown,
  signal?: AbortSignal,
): AsyncGenerator<AggregatedHookResult> {
  yield* executeHooks({
    hookInput: {
      hook_event_name: 'PostToolUse',
      session_id: getSessionId(),
      cwd: process.cwd(),
      tool_name: toolName,
      tool_input: toolInput,
      tool_response: toolResponse,
      tool_use_id: toolUseID,
    },
    matchQuery: toolName,
    signal,
  })
}

// ---------------------------------------------------------------------------
// SessionStart — called when session begins/resumes/clears/compacts
// ---------------------------------------------------------------------------

export async function* executeSessionStartHooks(
  source: 'startup' | 'resume' | 'clear' | 'compact',
  signal?: AbortSignal,
): AsyncGenerator<AggregatedHookResult> {
  yield* executeHooks({
    hookInput: {
      hook_event_name: 'SessionStart',
      session_id: getSessionId(),
      cwd: process.cwd(),
      source,
    },
    matchQuery: source,
    signal,
  })
}

// ---------------------------------------------------------------------------
// UserPromptSubmit — called when user submits a prompt
// ---------------------------------------------------------------------------

export async function* executeUserPromptSubmitHooks(
  prompt: string,
  signal?: AbortSignal,
): AsyncGenerator<AggregatedHookResult> {
  yield* executeHooks({
    hookInput: {
      hook_event_name: 'UserPromptSubmit',
      session_id: getSessionId(),
      cwd: process.cwd(),
      prompt,
    },
    signal,
    // No matchQuery — all UserPromptSubmit hooks fire
  })
}

// ---------------------------------------------------------------------------
// Task lifecycle hooks — TaskCreated / TaskCompleted
// ---------------------------------------------------------------------------

function executeTaskHooks(
  event: 'TaskCreated' | 'TaskCompleted',
  taskId: string,
  subject: string,
  description: string,
  signal?: AbortSignal,
): AsyncGenerator<AggregatedHookResult> {
  return executeHooks({
    hookInput: {
      hook_event_name: event,
      session_id: getSessionId(),
      cwd: process.cwd(),
      task_id: taskId,
      task_subject: subject,
      task_description: description,
    },
    signal,
  })
}

export async function* executeTaskCreatedHooks(
  taskId: string, subject: string, description: string, signal?: AbortSignal,
): AsyncGenerator<AggregatedHookResult> {
  yield* executeTaskHooks('TaskCreated', taskId, subject, description, signal)
}

export async function* executeTaskCompletedHooks(
  taskId: string, subject: string, description: string, signal?: AbortSignal,
): AsyncGenerator<AggregatedHookResult> {
  yield* executeTaskHooks('TaskCompleted', taskId, subject, description, signal)
}
