import { z } from 'zod'
import type { ZodType } from 'zod'
import type { ToolDef, ToolResultBlockParam } from '../services/tools/types.js'
import { getTask, getTaskListId } from '../services/tasks/index.js'
import type { Task } from '../services/tasks/index.js'
import { semanticString } from '../utils/schema.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskGetInput {
  taskId: string
}

export interface TaskGetOutput {
  task: Task | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TASK_GET_TOOL_NAME = 'TaskGet'

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function taskGetToolDef(): ToolDef<TaskGetInput, TaskGetOutput> {
  return {
    name: TASK_GET_TOOL_NAME,
    shouldDefer: true,
    maxResultSizeChars: 10_000,

    get inputSchema(): ZodType<TaskGetInput> {
      return z.strictObject({
        taskId: semanticString(z.string().min(1)).describe('The task ID to retrieve'),
      }) as ZodType<TaskGetInput>
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,

    async prompt() {
      return (
        'Retrieve full details of a specific task by ID. ' +
        'TaskList gives summaries; use TaskGet when you need the full description, ' +
        'dependency lists, or metadata before making an update.'
      )
    },

    async description(input) {
      return `Get task #${input.taskId}`
    },

    userFacingName(input) {
      return input.taskId ? `TaskGet(#${input.taskId})` : 'TaskGet'
    },

    async call(input) {
      const task = await getTask(getTaskListId(), input.taskId)
      return { data: { task } }
    },

    mapToolResultToToolResultBlockParam(
      output: TaskGetOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      if (!output.task) {
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUseID,
          content: 'Task not found.',
        }
      }

      const t = output.task
      const lines: string[] = [
        `Task #${t.id}`,
        `Subject: ${t.subject}`,
        `Status: ${t.status}`,
        `Description: ${t.description}`,
      ]
      if (t.owner) lines.push(`Owner: ${t.owner}`)
      if (t.activeForm) lines.push(`Active form: ${t.activeForm}`)
      if (t.blockedBy.length > 0) {
        lines.push(`Blocked by: ${t.blockedBy.map(id => `#${id}`).join(', ')}`)
      }
      if (t.blocks.length > 0) {
        lines.push(`Blocks: ${t.blocks.map(id => `#${id}`).join(', ')}`)
      }
      if (t.metadata && Object.keys(t.metadata).length > 0) {
        lines.push(`Metadata: ${JSON.stringify(t.metadata)}`)
      }

      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: lines.join('\n'),
      }
    },
  }
}
