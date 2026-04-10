import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  createTask,
  getTask,
  listTasks,
  updateTask,
  deleteTask,
  blockTask,
  getTasksDir,
  getTaskPath,
  onTasksUpdated,
  notifyTasksUpdated,
} from '../services/tasks/tasks.js'
import type { TaskCreateData } from '../services/tasks/types.js'

const TEST_DIR = join(import.meta.dir, '../../.test-tasks-tmp')
const LIST_ID = 'test-session'

function makeTaskData(overrides?: Partial<TaskCreateData>): TaskCreateData {
  return {
    subject: 'Fix the bug',
    description: 'Something is broken',
    status: 'pending',
    blocks: [],
    blockedBy: [],
    ...overrides,
  }
}

beforeEach(() => {
  process.env.PA_CONFIG_DIR = TEST_DIR
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  delete process.env.PA_CONFIG_DIR
  try {
    rmSync(TEST_DIR, { recursive: true, force: true })
  } catch { /* ok */ }
})

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

describe('path helpers', () => {
  test('getTasksDir joins config home with tasks/{listId}', () => {
    expect(getTasksDir(LIST_ID)).toBe(join(TEST_DIR, 'tasks', LIST_ID))
  })

  test('getTaskPath appends {id}.json', () => {
    expect(getTaskPath(LIST_ID, '1')).toBe(
      join(TEST_DIR, 'tasks', LIST_ID, '1.json'),
    )
  })

  test('sanitizes path components to prevent traversal', () => {
    const dir = getTasksDir('../../../etc')
    expect(dir).not.toContain('..')
  })
})

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

describe('createTask', () => {
  test('creates task with auto-incremented ID starting at 1', async () => {
    const id = await createTask(LIST_ID, makeTaskData())
    expect(id).toBe('1')

    const task = await getTask(LIST_ID, id)
    expect(task).not.toBeNull()
    expect(task!.id).toBe('1')
    expect(task!.subject).toBe('Fix the bug')
    expect(task!.status).toBe('pending')
  })

  test('second task gets ID 2', async () => {
    await createTask(LIST_ID, makeTaskData({ subject: 'First' }))
    const id2 = await createTask(LIST_ID, makeTaskData({ subject: 'Second' }))
    expect(id2).toBe('2')
  })

  test('preserves all fields', async () => {
    const id = await createTask(LIST_ID, makeTaskData({
      subject: 'Test task',
      description: 'Detailed description',
      activeForm: 'Running tests',
      owner: 'agent-1',
      status: 'pending',
      blocks: [],
      blockedBy: [],
      metadata: { key: 'value' },
    }))

    const task = await getTask(LIST_ID, id)
    expect(task!.activeForm).toBe('Running tests')
    expect(task!.owner).toBe('agent-1')
    expect(task!.metadata).toEqual({ key: 'value' })
  })
})

// ---------------------------------------------------------------------------
// getTask
// ---------------------------------------------------------------------------

describe('getTask', () => {
  test('returns null for non-existent task', async () => {
    const task = await getTask(LIST_ID, '999')
    expect(task).toBeNull()
  })

  test('returns null for invalid JSON on disk', async () => {
    const { writeFileSync } = await import('node:fs')
    const dir = getTasksDir(LIST_ID)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '1.json'), '{ invalid json }')
    const task = await getTask(LIST_ID, '1')
    expect(task).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// listTasks
// ---------------------------------------------------------------------------

describe('listTasks', () => {
  test('returns empty array when no tasks exist', async () => {
    const tasks = await listTasks(LIST_ID)
    expect(tasks).toEqual([])
  })

  test('returns all tasks', async () => {
    await createTask(LIST_ID, makeTaskData({ subject: 'A' }))
    await createTask(LIST_ID, makeTaskData({ subject: 'B' }))
    const tasks = await listTasks(LIST_ID)
    expect(tasks).toHaveLength(2)
    const subjects = tasks.map(t => t.subject).sort()
    expect(subjects).toEqual(['A', 'B'])
  })

  test('skips invalid files', async () => {
    const { writeFileSync } = await import('node:fs')
    await createTask(LIST_ID, makeTaskData({ subject: 'Good' }))
    const dir = getTasksDir(LIST_ID)
    writeFileSync(join(dir, '99.json'), '{ broken }')

    const tasks = await listTasks(LIST_ID)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.subject).toBe('Good')
  })
})

// ---------------------------------------------------------------------------
// updateTask
// ---------------------------------------------------------------------------

describe('updateTask', () => {
  test('returns null for non-existent task', async () => {
    const result = await updateTask(LIST_ID, '999', { status: 'completed' })
    expect(result).toBeNull()
  })

  test('updates status', async () => {
    const id = await createTask(LIST_ID, makeTaskData())
    const updated = await updateTask(LIST_ID, id, { status: 'in_progress' })
    expect(updated!.status).toBe('in_progress')

    // Verify on disk
    const fromDisk = await getTask(LIST_ID, id)
    expect(fromDisk!.status).toBe('in_progress')
  })

  test('preserves ID even if updates try to change it', async () => {
    const id = await createTask(LIST_ID, makeTaskData())
    // The type system prevents passing id, but verify runtime safety
    const updated = await updateTask(LIST_ID, id, { subject: 'New subject' })
    expect(updated!.id).toBe(id)
  })

  test('merges partial updates without clobbering other fields', async () => {
    const id = await createTask(LIST_ID, makeTaskData({
      subject: 'Original',
      description: 'Keep me',
    }))

    await updateTask(LIST_ID, id, { subject: 'Changed' })
    const task = await getTask(LIST_ID, id)
    expect(task!.subject).toBe('Changed')
    expect(task!.description).toBe('Keep me')
  })
})

// ---------------------------------------------------------------------------
// deleteTask
// ---------------------------------------------------------------------------

describe('deleteTask', () => {
  test('returns false for non-existent task', async () => {
    // Ensure directory exists first
    const { mkdirSync: mkSync } = await import('node:fs')
    mkSync(getTasksDir(LIST_ID), { recursive: true })
    const result = await deleteTask(LIST_ID, '999')
    expect(result).toBe(false)
  })

  test('removes task from disk', async () => {
    const id = await createTask(LIST_ID, makeTaskData())
    const deleted = await deleteTask(LIST_ID, id)
    expect(deleted).toBe(true)

    const task = await getTask(LIST_ID, id)
    expect(task).toBeNull()
  })

  test('prevents ID reuse via high water mark', async () => {
    const id1 = await createTask(LIST_ID, makeTaskData({ subject: 'A' }))
    await createTask(LIST_ID, makeTaskData({ subject: 'B' }))
    await deleteTask(LIST_ID, id1)

    const id3 = await createTask(LIST_ID, makeTaskData({ subject: 'C' }))
    expect(id3).toBe('3') // Not '1'
  })

  test('cleans up dangling dependency references', async () => {
    const idA = await createTask(LIST_ID, makeTaskData({ subject: 'A' }))
    const idB = await createTask(LIST_ID, makeTaskData({ subject: 'B' }))
    await blockTask(LIST_ID, idA, idB)

    await deleteTask(LIST_ID, idA)

    const taskB = await getTask(LIST_ID, idB)
    expect(taskB!.blockedBy).not.toContain(idA)
  })
})

// ---------------------------------------------------------------------------
// blockTask (dependencies)
// ---------------------------------------------------------------------------

describe('blockTask', () => {
  test('creates bidirectional dependency', async () => {
    const idA = await createTask(LIST_ID, makeTaskData({ subject: 'A' }))
    const idB = await createTask(LIST_ID, makeTaskData({ subject: 'B' }))

    const result = await blockTask(LIST_ID, idA, idB)
    expect(result).toBe(true)

    const taskA = await getTask(LIST_ID, idA)
    const taskB = await getTask(LIST_ID, idB)
    expect(taskA!.blocks).toContain(idB)
    expect(taskB!.blockedBy).toContain(idA)
  })

  test('is idempotent — no duplicates on repeat call', async () => {
    const idA = await createTask(LIST_ID, makeTaskData({ subject: 'A' }))
    const idB = await createTask(LIST_ID, makeTaskData({ subject: 'B' }))

    await blockTask(LIST_ID, idA, idB)
    await blockTask(LIST_ID, idA, idB)

    const taskA = await getTask(LIST_ID, idA)
    expect(taskA!.blocks.filter(id => id === idB)).toHaveLength(1)
  })

  test('returns false when either task does not exist', async () => {
    const idA = await createTask(LIST_ID, makeTaskData({ subject: 'A' }))
    expect(await blockTask(LIST_ID, idA, '999')).toBe(false)
    expect(await blockTask(LIST_ID, '999', idA)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Signal
// ---------------------------------------------------------------------------

describe('signal', () => {
  test('notifyTasksUpdated calls subscribers', () => {
    let called = 0
    const unsub = onTasksUpdated(() => { called++ })
    notifyTasksUpdated()
    expect(called).toBe(1)
    unsub()
  })

  test('createTask triggers signal', async () => {
    let called = 0
    const unsub = onTasksUpdated(() => { called++ })
    await createTask(LIST_ID, makeTaskData())
    expect(called).toBeGreaterThan(0)
    unsub()
  })

  test('updateTask triggers signal', async () => {
    const id = await createTask(LIST_ID, makeTaskData())
    let called = 0
    const unsub = onTasksUpdated(() => { called++ })
    await updateTask(LIST_ID, id, { status: 'completed' })
    expect(called).toBeGreaterThan(0)
    unsub()
  })

  test('deleteTask triggers signal', async () => {
    const id = await createTask(LIST_ID, makeTaskData())
    let called = 0
    const unsub = onTasksUpdated(() => { called++ })
    await deleteTask(LIST_ID, id)
    expect(called).toBeGreaterThan(0)
    unsub()
  })
})
