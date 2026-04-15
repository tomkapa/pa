import { z } from 'zod'
import type { ZodType } from 'zod'
import type { ToolDef, ToolResultBlockParam } from '../services/tools/types.js'
import { listTasks, getTaskListId, INTERNAL_METADATA_KEY, type TaskStatus } from '../services/tasks/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskListInput = Record<string, never>

export interface TaskSummary {
  id: string
  subject: string
  status: TaskStatus
  owner?: string
  blockedBy: string[]
}

export interface TaskListOutput {
  tasks: TaskSummary[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TASK_LIST_TOOL_NAME = 'TaskList'

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function taskListToolDef(): ToolDef<TaskListInput, TaskListOutput> {
  return {
    name: TASK_LIST_TOOL_NAME,
    shouldDefer: true,
    maxResultSizeChars: 20_000,

    get inputSchema(): ZodType<TaskListInput> {
      return z.strictObject({}) as ZodType<TaskListInput>
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,

    async prompt() {
      return (
        'List all tasks with their current status. Shows task summaries — ' +
        'use TaskGet for full details.\n\n' +
        'Blockers shown are only *unresolved* (non-completed) blockers. ' +
        'After completing a task, call TaskList to find newly unblocked work ' +
        'or see if your completion unblocked others.'
      )
    },

    async description() {
      return 'List all tasks'
    },

    userFacingName() {
      return 'TaskList'
    },

    async call() {
      const allTasks = await listTasks(getTaskListId())

      // Filter out internal tasks
      const visibleTasks = allTasks.filter(t => !t.metadata?.[INTERNAL_METADATA_KEY])

      // Build resolved set for dependency filtering
      const resolvedIds = new Set(
        allTasks.filter(t => t.status === 'completed').map(t => t.id),
      )

      const summaries: TaskSummary[] = visibleTasks.map(t => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        owner: t.owner,
        blockedBy: t.blockedBy.filter(id => !resolvedIds.has(id)),
      }))

      return { data: { tasks: summaries } }
    },

    mapToolResultToToolResultBlockParam(
      output: TaskListOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      if (output.tasks.length === 0) {
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUseID,
          content: 'No tasks.',
        }
      }

      const lines = output.tasks.map(t => {
        let line = `#${t.id} [${t.status}] ${t.subject}`
        if (t.owner) line += ` (${t.owner})`
        if (t.blockedBy.length > 0) {
          line += ` [blocked by ${t.blockedBy.map(id => `#${id}`).join(', ')}]`
        }
        return line
      })

      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: lines.join('\n'),
      }
    },
  }
}
