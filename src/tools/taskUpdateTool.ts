import { z } from 'zod'
import type { ZodType } from 'zod'
import type { ToolDef, ToolResultBlockParam } from '../services/tools/types.js'
import {
  getTask,
  updateTask,
  deleteTask,
  blockTask,
  getTaskListId,
  notifyTasksUpdated,
  TASK_STATUSES,
} from '../services/tasks/index.js'
import { executeTaskCompletedHooks } from '../services/hooks/index.js'
import { semanticString } from '../utils/schema.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// 'deleted' is a pseudo-status that triggers task deletion
const UPDATE_STATUSES = [...TASK_STATUSES, 'deleted'] as const

export interface TaskUpdateInput {
  taskId: string
  subject?: string
  description?: string
  activeForm?: string
  status?: (typeof UPDATE_STATUSES)[number]
  owner?: string
  addBlocks?: string[]
  addBlockedBy?: string[]
  metadata?: Record<string, unknown>
}

export interface TaskUpdateOutput {
  success: boolean
  taskId: string
  updatedFields: string[]
  statusChange?: { from: string; to: string }
  deleted?: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TASK_UPDATE_TOOL_NAME = 'TaskUpdate'

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function taskUpdateToolDef(): ToolDef<TaskUpdateInput, TaskUpdateOutput> {
  return {
    name: TASK_UPDATE_TOOL_NAME,
    shouldDefer: true,
    maxResultSizeChars: 5_000,

    get inputSchema(): ZodType<TaskUpdateInput> {
      return z.strictObject({
        taskId: semanticString(z.string().min(1)).describe('The task ID to update'),
        subject: z.string().min(1).optional().describe('New task subject'),
        description: z.string().optional().describe('New task description'),
        activeForm: z.string().optional().describe('Spinner text for in_progress state'),
        status: z.enum(UPDATE_STATUSES).optional().describe(
          'New status: pending, in_progress, completed, or deleted. ' +
          '"deleted" removes the task entirely.',
        ),
        owner: z.string().optional().describe('Agent name/ID that owns this task'),
        addBlocks: z.array(semanticString(z.string())).optional().describe('Task IDs this task should block'),
        addBlockedBy: z.array(semanticString(z.string())).optional().describe('Task IDs that should block this task'),
        metadata: z.record(z.unknown()).optional().describe(
          'Metadata to merge. Set a key to null to delete it.',
        ),
      }) as ZodType<TaskUpdateInput>
    },

    isConcurrencySafe: () => true,

    async prompt() {
      return (
        'Update a task\'s fields, status, or dependencies.\n\n' +
        'Status workflow: pending → in_progress → completed\n' +
        'Set status to "deleted" to remove a task entirely.\n\n' +
        'Common operations:\n' +
        '- Mark in-progress: { taskId: "1", status: "in_progress" }\n' +
        '- Complete: { taskId: "1", status: "completed" }\n' +
        '- Delete: { taskId: "1", status: "deleted" }\n' +
        '- Add dependency: { taskId: "2", addBlockedBy: ["1"] }\n\n' +
        'Metadata merge: keys set to null are deleted from existing metadata.'
      )
    },

    async description(input) {
      if (input.status === 'deleted') return `Delete task #${input.taskId}`
      if (input.status) return `Update task #${input.taskId} → ${input.status}`
      return `Update task #${input.taskId}`
    },

    userFacingName(input) {
      return input.taskId ? `TaskUpdate(#${input.taskId})` : 'TaskUpdate'
    },

    async call(input, context) {
      const taskListId = getTaskListId()
      const existing = await getTask(taskListId, input.taskId)

      if (!existing) {
        return {
          data: {
            success: false,
            taskId: input.taskId,
            updatedFields: [],
            error: `Task #${input.taskId} not found.`,
          },
        }
      }

      // Handle deletion
      if (input.status === 'deleted') {
        const deleted = await deleteTask(taskListId, input.taskId)
        return {
          data: {
            success: deleted,
            taskId: input.taskId,
            updatedFields: [],
            deleted: true,
          },
        }
      }

      // Fire TaskCompleted hooks before persisting completion
      if (input.status === 'completed') {
        for await (const hookResult of executeTaskCompletedHooks(
          input.taskId,
          existing.subject,
          existing.description,
          context.abortController.signal,
        )) {
          if (hookResult.blockingError) {
            return {
              data: {
                success: false,
                taskId: input.taskId,
                updatedFields: [],
                error: `Completion blocked by hook: ${hookResult.blockingError.message}`,
              },
            }
          }
        }
      }

      // Build updates object, tracking which fields changed
      const updatedFields: string[] = []
      const updates: Partial<Omit<typeof existing, 'id'>> = {}

      if (input.subject !== undefined && input.subject !== existing.subject) {
        updates.subject = input.subject
        updatedFields.push('subject')
      }
      if (input.description !== undefined && input.description !== existing.description) {
        updates.description = input.description
        updatedFields.push('description')
      }
      if (input.activeForm !== undefined && input.activeForm !== existing.activeForm) {
        updates.activeForm = input.activeForm
        updatedFields.push('activeForm')
      }
      if (input.status !== undefined && input.status !== existing.status) {
        updates.status = input.status
        updatedFields.push('status')
      }
      if (input.owner !== undefined && input.owner !== existing.owner) {
        updates.owner = input.owner
        updatedFields.push('owner')
      }

      // Metadata merge: null values delete keys
      if (input.metadata !== undefined) {
        const merged = { ...(existing.metadata ?? {}) }
        let metadataChanged = false
        for (const [key, value] of Object.entries(input.metadata)) {
          if (value === null) {
            if (key in merged) {
              delete merged[key]
              metadataChanged = true
            }
          } else if (merged[key] !== value) {
            merged[key] = value
            metadataChanged = true
          }
        }
        if (metadataChanged) {
          updates.metadata = merged
          updatedFields.push('metadata')
        }
      }

      // Apply field updates
      const statusChange = input.status && input.status !== existing.status
        ? { from: existing.status, to: input.status }
        : undefined

      if (updatedFields.length > 0) {
        await updateTask(taskListId, input.taskId, updates)
      }

      // Process dependency additions in parallel.
      // blockTask no longer fires notifyTasksUpdated — we signal once below.
      const depOps: Promise<boolean>[] = []
      if (input.addBlocks) {
        for (const blockId of input.addBlocks) {
          if (!existing.blocks.includes(blockId)) {
            depOps.push(blockTask(taskListId, input.taskId, blockId))
          }
        }
        if (input.addBlocks.length > 0) updatedFields.push('blocks')
      }
      if (input.addBlockedBy) {
        for (const blockerId of input.addBlockedBy) {
          if (!existing.blockedBy.includes(blockerId)) {
            depOps.push(blockTask(taskListId, blockerId, input.taskId))
          }
        }
        if (input.addBlockedBy.length > 0) updatedFields.push('blockedBy')
      }
      if (depOps.length > 0) {
        await Promise.all(depOps)
        notifyTasksUpdated()
      }

      return {
        data: {
          success: true,
          taskId: input.taskId,
          updatedFields,
          statusChange,
        },
      }
    },

    mapToolResultToToolResultBlockParam(
      output: TaskUpdateOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      if (!output.success) {
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUseID,
          content: output.error ?? `Failed to update task #${output.taskId}.`,
          is_error: true,
        }
      }

      if (output.deleted) {
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUseID,
          content: `Task #${output.taskId} deleted.`,
        }
      }

      const parts = [`Updated task #${output.taskId}`]
      if (output.updatedFields.length > 0) {
        parts.push(output.updatedFields.join(', '))
      }

      let content = parts.join(': ')

      if (output.statusChange?.to === 'completed') {
        content +=
          '\nTask completed. Call TaskList now to find your next available task or see if your work unblocked others.'
      }

      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content,
      }
    },
  }
}
