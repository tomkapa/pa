import { z } from 'zod'

// ---------------------------------------------------------------------------
// Task status & data model
// ---------------------------------------------------------------------------

export const TASK_STATUSES = ['pending', 'in_progress', 'completed'] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TaskSchema = z.strictObject({
  id: z.string(),
  subject: z.string(),
  description: z.string(),
  activeForm: z.string().optional(),
  owner: z.string().optional(),
  status: z.enum(TASK_STATUSES),
  blocks: z.array(z.string()),
  blockedBy: z.array(z.string()),
  metadata: z.record(z.unknown()).optional(),
})

export type Task = z.infer<typeof TaskSchema>

export type TaskCreateData = Omit<Task, 'id'>

/** Metadata key that marks a task as internal (hidden from TaskList). */
export const INTERNAL_METADATA_KEY = '_internal'
