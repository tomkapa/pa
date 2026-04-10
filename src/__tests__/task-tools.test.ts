import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { buildTool } from '../services/tools/build-tool.js'
import { taskCreateToolDef } from '../tools/taskCreateTool.js'
import { taskGetToolDef } from '../tools/taskGetTool.js'
import { taskListToolDef } from '../tools/taskListTool.js'
import { taskUpdateToolDef } from '../tools/taskUpdateTool.js'
import { makeContext } from '../testing/make-context.js'
import { getTask, getTaskListId, listTasks } from '../services/tasks/index.js'

const TEST_DIR = join(import.meta.dir, '../../.test-task-tools-tmp')

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
// TaskCreateTool
// ---------------------------------------------------------------------------

describe('TaskCreateTool', () => {
  const tool = buildTool(taskCreateToolDef())

  test('has correct name and metadata', () => {
    expect(tool.name).toBe('TaskCreate')
    expect(tool.isReadOnly({ subject: '', description: '' })).toBe(false)
    expect(tool.isConcurrencySafe({ subject: '', description: '' })).toBe(true)
  })

  test('creates a task and returns id + subject', async () => {
    const ctx = makeContext()
    const result = await tool.call(
      { subject: 'Fix bug', description: 'The widget is broken' },
      ctx,
    )

    expect(result.data.task.id).toBe('1')
    expect(result.data.task.subject).toBe('Fix bug')

    // Verify on disk
    const task = await getTask(getTaskListId(), '1')
    expect(task).not.toBeNull()
    expect(task!.subject).toBe('Fix bug')
    expect(task!.status).toBe('pending')
  })

  test('maps result to tool_result block', () => {
    const output = { task: { id: '1', subject: 'Fix bug' } }
    const block = tool.mapToolResultToToolResultBlockParam(output, 'use-123')
    expect(block.content).toBe('Task #1 created successfully: Fix bug')
  })
})

// ---------------------------------------------------------------------------
// TaskGetTool
// ---------------------------------------------------------------------------

describe('TaskGetTool', () => {
  const createTool = buildTool(taskCreateToolDef())
  const getTool = buildTool(taskGetToolDef())

  test('has correct name and metadata', () => {
    expect(getTool.name).toBe('TaskGet')
    expect(getTool.isReadOnly({ taskId: '1' })).toBe(true)
    expect(getTool.isConcurrencySafe({ taskId: '1' })).toBe(true)
  })

  test('returns task details', async () => {
    const ctx = makeContext()
    await createTool.call(
      { subject: 'Fix bug', description: 'Details here' },
      ctx,
    )

    const result = await getTool.call({ taskId: '1' }, ctx)
    expect(result.data.task).not.toBeNull()
    expect(result.data.task!.subject).toBe('Fix bug')
    expect(result.data.task!.description).toBe('Details here')
  })

  test('returns null for non-existent task', async () => {
    const ctx = makeContext()
    const result = await getTool.call({ taskId: '999' }, ctx)
    expect(result.data.task).toBeNull()
  })

  test('maps non-existent task to "not found"', () => {
    const block = getTool.mapToolResultToToolResultBlockParam(
      { task: null },
      'use-1',
    )
    expect(block.content).toBe('Task not found.')
  })

  test('maps found task to multi-line output', async () => {
    const ctx = makeContext()
    await createTool.call(
      { subject: 'Fix bug', description: 'Details' },
      ctx,
    )
    const result = await getTool.call({ taskId: '1' }, ctx)
    const block = getTool.mapToolResultToToolResultBlockParam(result.data, 'use-1')
    const content = block.content as string
    expect(content).toContain('Task #1')
    expect(content).toContain('Fix bug')
    expect(content).toContain('pending')
  })
})

// ---------------------------------------------------------------------------
// TaskListTool
// ---------------------------------------------------------------------------

describe('TaskListTool', () => {
  const createTool = buildTool(taskCreateToolDef())
  const listToolInst = buildTool(taskListToolDef())

  test('has correct name and metadata', () => {
    expect(listToolInst.name).toBe('TaskList')
    expect(listToolInst.isReadOnly({})).toBe(true)
    expect(listToolInst.isConcurrencySafe({})).toBe(true)
  })

  test('returns empty when no tasks', async () => {
    const ctx = makeContext()
    const result = await listToolInst.call({}, ctx)
    expect(result.data.tasks).toEqual([])
  })

  test('returns task summaries', async () => {
    const ctx = makeContext()
    await createTool.call({ subject: 'A', description: 'd' }, ctx)
    await createTool.call({ subject: 'B', description: 'd' }, ctx)

    const result = await listToolInst.call({}, ctx)
    expect(result.data.tasks).toHaveLength(2)
    expect(result.data.tasks[0]!.subject).toBe('A')
  })

  test('filters resolved blockers from output', async () => {
    const ctx = makeContext()
    const updateTool = buildTool(taskUpdateToolDef())

    await createTool.call({ subject: 'Blocker', description: 'd' }, ctx)
    await createTool.call({ subject: 'Blocked', description: 'd' }, ctx)
    await updateTool.call({ taskId: '2', addBlockedBy: ['1'] }, ctx)

    // Before completion — blocker visible
    let result = await listToolInst.call({}, ctx)
    const blockedTask = result.data.tasks.find(t => t.id === '2')
    expect(blockedTask!.blockedBy).toContain('1')

    // Complete blocker
    await updateTool.call({ taskId: '1', status: 'completed' }, ctx)

    // After completion — blocker resolved
    result = await listToolInst.call({}, ctx)
    const unblockedTask = result.data.tasks.find(t => t.id === '2')
    expect(unblockedTask!.blockedBy).not.toContain('1')
  })

  test('maps empty list to "No tasks."', () => {
    const block = listToolInst.mapToolResultToToolResultBlockParam(
      { tasks: [] },
      'use-1',
    )
    expect(block.content).toBe('No tasks.')
  })

  test('maps task list to one-line-per-task format', () => {
    const block = listToolInst.mapToolResultToToolResultBlockParam(
      {
        tasks: [
          { id: '1', subject: 'Fix bug', status: 'pending', blockedBy: [] },
          { id: '2', subject: 'Add tests', status: 'in_progress', owner: 'agent', blockedBy: ['1'] },
        ],
      },
      'use-1',
    )
    const content = block.content as string
    expect(content).toContain('#1 [pending] Fix bug')
    expect(content).toContain('#2 [in_progress] Add tests (agent) [blocked by #1]')
  })
})

// ---------------------------------------------------------------------------
// TaskUpdateTool
// ---------------------------------------------------------------------------

describe('TaskUpdateTool', () => {
  const createTool = buildTool(taskCreateToolDef())
  const updateTool = buildTool(taskUpdateToolDef())

  test('has correct name and metadata', () => {
    expect(updateTool.name).toBe('TaskUpdate')
    expect(updateTool.isConcurrencySafe({ taskId: '1' })).toBe(true)
  })

  test('returns error for non-existent task', async () => {
    const ctx = makeContext()
    const result = await updateTool.call({ taskId: '999' }, ctx)
    expect(result.data.success).toBe(false)
    expect(result.data.error).toContain('not found')
  })

  test('updates status', async () => {
    const ctx = makeContext()
    await createTool.call({ subject: 'T', description: 'd' }, ctx)

    const result = await updateTool.call(
      { taskId: '1', status: 'in_progress' },
      ctx,
    )
    expect(result.data.success).toBe(true)
    expect(result.data.statusChange).toEqual({ from: 'pending', to: 'in_progress' })

    const task = await getTask(getTaskListId(), '1')
    expect(task!.status).toBe('in_progress')
  })

  test('deletes task via status="deleted"', async () => {
    const ctx = makeContext()
    await createTool.call({ subject: 'T', description: 'd' }, ctx)

    const result = await updateTool.call(
      { taskId: '1', status: 'deleted' },
      ctx,
    )
    expect(result.data.success).toBe(true)
    expect(result.data.deleted).toBe(true)

    const task = await getTask(getTaskListId(), '1')
    expect(task).toBeNull()
  })

  test('adds dependencies via addBlocks', async () => {
    const ctx = makeContext()
    await createTool.call({ subject: 'A', description: 'd' }, ctx)
    await createTool.call({ subject: 'B', description: 'd' }, ctx)

    await updateTool.call({ taskId: '1', addBlocks: ['2'] }, ctx)

    const taskA = await getTask(getTaskListId(), '1')
    const taskB = await getTask(getTaskListId(), '2')
    expect(taskA!.blocks).toContain('2')
    expect(taskB!.blockedBy).toContain('1')
  })

  test('adds dependencies via addBlockedBy', async () => {
    const ctx = makeContext()
    await createTool.call({ subject: 'A', description: 'd' }, ctx)
    await createTool.call({ subject: 'B', description: 'd' }, ctx)

    await updateTool.call({ taskId: '2', addBlockedBy: ['1'] }, ctx)

    const taskA = await getTask(getTaskListId(), '1')
    const taskB = await getTask(getTaskListId(), '2')
    expect(taskA!.blocks).toContain('2')
    expect(taskB!.blockedBy).toContain('1')
  })

  test('merges metadata — null values delete keys', async () => {
    const ctx = makeContext()
    await createTool.call(
      { subject: 'T', description: 'd', metadata: { a: 1, b: 2 } },
      ctx,
    )

    await updateTool.call(
      { taskId: '1', metadata: { b: null, c: 3 } },
      ctx,
    )

    const task = await getTask(getTaskListId(), '1')
    expect(task!.metadata).toEqual({ a: 1, c: 3 })
  })

  test('completion result includes nudge message', () => {
    const output = {
      success: true,
      taskId: '1',
      updatedFields: ['status'],
      statusChange: { from: 'in_progress', to: 'completed' },
    }
    const block = updateTool.mapToolResultToToolResultBlockParam(output, 'use-1')
    const content = block.content as string
    expect(content).toContain('Task completed')
    expect(content).toContain('TaskList')
  })

  test('error result has is_error flag', () => {
    const output = {
      success: false,
      taskId: '999',
      updatedFields: [],
      error: 'Task #999 not found.',
    }
    const block = updateTool.mapToolResultToToolResultBlockParam(output, 'use-1')
    expect((block as { is_error?: boolean }).is_error).toBe(true)
  })

  test('deletion result message', () => {
    const output = {
      success: true,
      taskId: '1',
      updatedFields: [],
      deleted: true,
    }
    const block = updateTool.mapToolResultToToolResultBlockParam(output, 'use-1')
    expect(block.content).toBe('Task #1 deleted.')
  })
})

// ---------------------------------------------------------------------------
// Integration: full lifecycle
// ---------------------------------------------------------------------------

describe('task lifecycle integration', () => {
  const createTool = buildTool(taskCreateToolDef())
  const listToolInst = buildTool(taskListToolDef())
  const updateTool = buildTool(taskUpdateToolDef())

  test('create → list → update → complete → list shows resolved', async () => {
    const ctx = makeContext()

    // Create two tasks
    await createTool.call({ subject: 'Setup', description: 'Init' }, ctx)
    await createTool.call({ subject: 'Build', description: 'Code' }, ctx)

    // Add dependency: Build blocked by Setup
    await updateTool.call({ taskId: '2', addBlockedBy: ['1'] }, ctx)

    // List shows blocker
    let list = await listToolInst.call({}, ctx)
    expect(list.data.tasks.find(t => t.id === '2')!.blockedBy).toEqual(['1'])

    // Complete Setup
    await updateTool.call({ taskId: '1', status: 'completed' }, ctx)

    // List shows resolved blocker
    list = await listToolInst.call({}, ctx)
    expect(list.data.tasks.find(t => t.id === '2')!.blockedBy).toEqual([])

    // Delete Build
    await updateTool.call({ taskId: '2', status: 'deleted' }, ctx)

    // Next create gets ID 3 (not 1 or 2)
    await createTool.call({ subject: 'Cleanup', description: 'Tidy' }, ctx)
    const tasks = await listTasks(getTaskListId())
    const ids = tasks.map(t => t.id)
    expect(ids).toContain('1')
    expect(ids).toContain('3')
    expect(ids).not.toContain('2')
  })
})
