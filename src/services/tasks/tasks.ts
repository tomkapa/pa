// ---------------------------------------------------------------------------
// Task Storage Module — disk-persisted task management
//
// Tasks are stored as individual JSON files in:
//   ~/.pa/tasks/{taskListId}/{id}.json
//
// Each session gets its own isolated task list (taskListId = sessionId).
// A .highwatermark file prevents ID reuse after deletion.
// ---------------------------------------------------------------------------

import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { getConfigHomeDir } from '../session/paths.js'
import { getSessionId } from '../observability/state.js'
import { isNodeError } from '../../utils/error.js'
import { logForDebugging } from '../observability/debug.js'
import { createSignal } from '../../utils/signal.js'
import { TaskSchema, type Task, type TaskCreateData } from './types.js'

// ---------------------------------------------------------------------------
// Path sanitization — prevents directory traversal
// ---------------------------------------------------------------------------

const SAFE_PATH_RE = /[^a-zA-Z0-9_-]/g

function sanitizePathComponent(value: string): string {
  return value.replace(SAFE_PATH_RE, '-')
}

// ---------------------------------------------------------------------------
// Directory & path helpers
// ---------------------------------------------------------------------------

export function getTasksBaseDir(): string {
  return join(getConfigHomeDir(), 'tasks')
}

export function getTasksDir(taskListId: string): string {
  return join(getTasksBaseDir(), sanitizePathComponent(taskListId))
}

export function getTaskPath(taskListId: string, taskId: string): string {
  return join(getTasksDir(taskListId), `${sanitizePathComponent(taskId)}.json`)
}

export async function ensureTasksDir(taskListId: string): Promise<void> {
  await mkdir(getTasksDir(taskListId), { recursive: true })
}

// ---------------------------------------------------------------------------
// Task list identity
// ---------------------------------------------------------------------------

export function getTaskListId(): string {
  return getSessionId()
}

// ---------------------------------------------------------------------------
// Signal — notifies UI when tasks change
// ---------------------------------------------------------------------------

const tasksUpdated = createSignal()

export const onTasksUpdated = tasksUpdated.subscribe

export function notifyTasksUpdated(): void {
  try {
    tasksUpdated.emit()
  } catch (err: unknown) {
    // Listener errors must not fail a task mutation, but log so
    // they are diagnosable instead of silently lost.
    logForDebugging(
      `notifyTasksUpdated: listener threw — ${err instanceof Error ? err.message : String(err)}`,
      { level: 'warn' },
    )
  }
}

// ---------------------------------------------------------------------------
// High water mark — prevents ID reuse after deletion
// ---------------------------------------------------------------------------

const HIGHWATERMARK_FILE = '.highwatermark'

async function readHighWaterMark(taskListId: string): Promise<number> {
  try {
    const content = await readFile(
      join(getTasksDir(taskListId), HIGHWATERMARK_FILE),
      'utf-8',
    )
    const parsed = parseInt(content.trim(), 10)
    return Number.isNaN(parsed) ? 0 : parsed
  } catch (e: unknown) {
    if (isNodeError(e) && e.code === 'ENOENT') return 0
    throw e
  }
}

async function writeHighWaterMark(taskListId: string, value: number): Promise<void> {
  await writeFile(
    join(getTasksDir(taskListId), HIGHWATERMARK_FILE),
    String(value),
    'utf-8',
  )
}

async function findHighestTaskId(taskListId: string): Promise<number> {
  try {
    const entries = await readdir(getTasksDir(taskListId))
    let max = 0
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const num = parseInt(entry.slice(0, -5), 10)
      if (!Number.isNaN(num) && num > max) max = num
    }
    return max
  } catch (e: unknown) {
    if (isNodeError(e) && e.code === 'ENOENT') return 0
    throw e
  }
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export async function createTask(
  taskListId: string,
  data: TaskCreateData,
): Promise<string> {
  await ensureTasksDir(taskListId)

  const [hwm, highestFile] = await Promise.all([
    readHighWaterMark(taskListId),
    findHighestTaskId(taskListId),
  ])

  const nextId = Math.max(hwm, highestFile) + 1
  const id = String(nextId)

  const task: Task = { ...data, id }
  await Promise.all([
    writeFile(getTaskPath(taskListId, id), JSON.stringify(task, null, 2), 'utf-8'),
    writeHighWaterMark(taskListId, nextId),
  ])

  notifyTasksUpdated()
  return id
}

export async function getTask(
  taskListId: string,
  taskId: string,
): Promise<Task | null> {
  let content: string
  try {
    content = await readFile(getTaskPath(taskListId, taskId), 'utf-8')
  } catch (e: unknown) {
    if (isNodeError(e) && e.code === 'ENOENT') return null
    throw e
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    logForDebugging(`task ${taskId}: corrupt JSON on disk`, { level: 'warn' })
    return null
  }

  const result = TaskSchema.safeParse(parsed)
  if (!result.success) {
    logForDebugging(`task ${taskId}: invalid schema on disk — ${result.error.message}`, { level: 'warn' })
    return null
  }
  return result.data
}

export async function listTasks(taskListId: string): Promise<Task[]> {
  let entries: string[]
  try {
    entries = await readdir(getTasksDir(taskListId))
  } catch (e: unknown) {
    if (isNodeError(e) && e.code === 'ENOENT') return []
    throw e
  }

  const jsonFiles = entries.filter(e => e.endsWith('.json'))
  const tasks = await Promise.all(
    jsonFiles.map(async (file) => {
      const taskId = file.slice(0, -5)
      return getTask(taskListId, taskId)
    }),
  )

  return tasks.filter((t): t is Task => t !== null)
}

export async function updateTask(
  taskListId: string,
  taskId: string,
  updates: Partial<Omit<Task, 'id'>>,
): Promise<Task | null> {
  const existing = await getTask(taskListId, taskId)
  if (!existing) return null

  const updated: Task = { ...existing, ...updates, id: taskId }
  await writeFile(
    getTaskPath(taskListId, taskId),
    JSON.stringify(updated, null, 2),
    'utf-8',
  )

  notifyTasksUpdated()
  return updated
}

export async function deleteTask(
  taskListId: string,
  taskId: string,
): Promise<boolean> {
  const taskPath = getTaskPath(taskListId, taskId)

  // Update high water mark to prevent ID reuse
  const numericId = parseInt(taskId, 10)
  if (!Number.isNaN(numericId)) {
    const currentHwm = await readHighWaterMark(taskListId)
    if (numericId > currentHwm) {
      await writeHighWaterMark(taskListId, numericId)
    }
  }

  // Delete the file
  try {
    await unlink(taskPath)
  } catch (e: unknown) {
    if (isNodeError(e) && e.code === 'ENOENT') return false
    throw e
  }

  // Clean up dangling dependency references
  const remaining = await listTasks(taskListId)
  await Promise.all(
    remaining
      .filter(t => t.blocks.includes(taskId) || t.blockedBy.includes(taskId))
      .map(async (t) => {
        const cleaned: Task = {
          ...t,
          blocks: t.blocks.filter(id => id !== taskId),
          blockedBy: t.blockedBy.filter(id => id !== taskId),
        }
        await writeFile(
          getTaskPath(taskListId, t.id),
          JSON.stringify(cleaned, null, 2),
          'utf-8',
        )
      }),
  )

  notifyTasksUpdated()
  return true
}

// ---------------------------------------------------------------------------
// Dependency management
// ---------------------------------------------------------------------------

/**
 * Add a dependency edge: fromTaskId blocks toTaskId.
 *
 * Does NOT fire notifyTasksUpdated — callers (e.g. TaskUpdateTool)
 * are responsible for signaling once after all mutations complete,
 * avoiding redundant UI refreshes when adding multiple dependencies.
 */
export async function blockTask(
  taskListId: string,
  fromTaskId: string,
  toTaskId: string,
): Promise<boolean> {
  const [fromTask, toTask] = await Promise.all([
    getTask(taskListId, fromTaskId),
    getTask(taskListId, toTaskId),
  ])

  if (!fromTask || !toTask) return false

  const needsFromUpdate = !fromTask.blocks.includes(toTaskId)
  const needsToUpdate = !toTask.blockedBy.includes(fromTaskId)

  if (!needsFromUpdate && !needsToUpdate) return true

  const writes: Promise<void>[] = []
  if (needsFromUpdate) {
    const updated: Task = { ...fromTask, blocks: [...fromTask.blocks, toTaskId] }
    writes.push(writeFile(getTaskPath(taskListId, fromTaskId), JSON.stringify(updated, null, 2), 'utf-8'))
  }
  if (needsToUpdate) {
    const updated: Task = { ...toTask, blockedBy: [...toTask.blockedBy, fromTaskId] }
    writes.push(writeFile(getTaskPath(taskListId, toTaskId), JSON.stringify(updated, null, 2), 'utf-8'))
  }
  await Promise.all(writes)

  return true
}
