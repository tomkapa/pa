import { z } from 'zod'
import type { ZodType } from 'zod'
import type { ToolDef, ToolResultBlockParam } from '../services/tools/types.js'
import {
  createTask,
  deleteTask,
  getTaskListId,
} from '../services/tasks/index.js'
import { executeTaskCreatedHooks } from '../services/hooks/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskCreateInput {
  subject: string
  description: string
  activeForm?: string
  metadata?: Record<string, unknown>
}

export interface TaskCreateOutput {
  task: { id: string; subject: string }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TASK_CREATE_TOOL_NAME = 'TaskCreate'

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function taskCreateToolDef(): ToolDef<TaskCreateInput, TaskCreateOutput> {
  return {
    name: TASK_CREATE_TOOL_NAME,
    shouldDefer: true,
    maxResultSizeChars: 2_000,

    get inputSchema(): ZodType<TaskCreateInput> {
      return z.strictObject({
        subject: z.string().min(1).describe('Brief imperative title for the task'),
        description: z.string().min(1).describe('What needs to be done'),
        activeForm: z.string().optional().describe('Present-continuous text for spinner when in_progress (e.g. "Running tests")'),
        metadata: z.record(z.unknown()).optional().describe('Extensible key-value pairs'),
      }) as ZodType<TaskCreateInput>
    },

    isConcurrencySafe: () => true,

    async prompt() {
      return (
        'Create a new task to track a unit of work. Use this to break down complex, multi-step work ' +
        'into trackable tasks. Tasks start as `pending`.\n\n' +
        'Use tasks when:\n' +
        '- The work has 3+ distinct steps\n' +
        '- You need to track dependencies between steps\n' +
        '- The plan involves multiple files or complex changes\n\n' +
        'Do NOT create tasks for:\n' +
        '- Single trivial operations (one-line fixes, simple reads)\n' +
        '- Questions or explanations that don\'t involve code changes\n\n' +
        'After creating tasks, use TaskUpdate to set dependencies (addBlockedBy/addBlocks) ' +
        'and to transition status as you work (pending → in_progress → completed).'
      )
    },

    async description(input) {
      return `Create task: ${input.subject}`
    },

    userFacingName() {
      return 'TaskCreate'
    },

    async call(input, context) {
      const taskListId = getTaskListId()
      const taskId = await createTask(taskListId, {
        subject: input.subject,
        description: input.description,
        activeForm: input.activeForm,
        status: 'pending',
        owner: undefined,
        blocks: [],
        blockedBy: [],
        metadata: input.metadata,
      })

      // Fire TaskCreated hooks — rollback on blocking error
      for await (const hookResult of executeTaskCreatedHooks(
        taskId,
        input.subject,
        input.description,
        context.abortController.signal,
      )) {
        if (hookResult.blockingError) {
          await deleteTask(taskListId, taskId)
          throw new Error(
            `Task creation blocked by hook: ${hookResult.blockingError.message}`,
          )
        }
      }

      return {
        data: { task: { id: taskId, subject: input.subject } },
      }
    },

    mapToolResultToToolResultBlockParam(
      output: TaskCreateOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: `Task #${output.task.id} created successfully: ${output.task.subject}`,
      }
    },
  }
}
