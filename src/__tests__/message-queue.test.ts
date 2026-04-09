import { describe, expect, test, beforeEach } from 'bun:test'
import {
  enqueueCommand,
  drainAllCommands,
  clearCommandQueue,
  hasQueuedCommands,
  getQueueSnapshot,
  subscribeToCommandQueue,
  __resetCommandQueueForTests,
} from '../utils/messageQueue.js'
import type { QueuedCommand } from '../types/queue.js'

function cmd(value: string, uuid = `id-${value}`): QueuedCommand {
  return { value, uuid, mode: 'prompt' }
}

describe('messageQueue', () => {
  beforeEach(() => {
    __resetCommandQueueForTests()
  })

  test('starts empty', () => {
    expect(hasQueuedCommands()).toBe(false)
    expect(getQueueSnapshot()).toEqual([])
  })

  test('enqueue appends in FIFO order', () => {
    enqueueCommand(cmd('first'))
    enqueueCommand(cmd('second'))
    enqueueCommand(cmd('third'))
    expect(getQueueSnapshot().map(c => c.value)).toEqual(['first', 'second', 'third'])
    expect(hasQueuedCommands()).toBe(true)
  })

  test('drainAllCommands returns all items and empties the queue', () => {
    enqueueCommand(cmd('a'))
    enqueueCommand(cmd('b'))
    const drained = drainAllCommands()
    expect(drained.map(c => c.value)).toEqual(['a', 'b'])
    expect(hasQueuedCommands()).toBe(false)
    expect(getQueueSnapshot()).toEqual([])
  })

  test('drainAllCommands on an empty queue returns []', () => {
    expect(drainAllCommands()).toEqual([])
  })

  test('clearCommandQueue empties the queue', () => {
    enqueueCommand(cmd('a'))
    enqueueCommand(cmd('b'))
    clearCommandQueue()
    expect(hasQueuedCommands()).toBe(false)
    expect(getQueueSnapshot()).toEqual([])
  })

  test('snapshot reference is stable between mutations', () => {
    // This is the critical useSyncExternalStore contract: repeated getSnapshot
    // calls must return the exact same reference while the queue is
    // unchanged, or React will warn / loop forever.
    const s1 = getQueueSnapshot()
    const s2 = getQueueSnapshot()
    expect(s1).toBe(s2)

    enqueueCommand(cmd('a'))
    const s3 = getQueueSnapshot()
    expect(s3).not.toBe(s1)
    const s4 = getQueueSnapshot()
    expect(s4).toBe(s3)

    drainAllCommands()
    const s5 = getQueueSnapshot()
    expect(s5).not.toBe(s3)
    expect(s5).toEqual([])
  })

  test('snapshot is frozen to prevent external mutation', () => {
    enqueueCommand(cmd('a'))
    const snap = getQueueSnapshot()
    expect(Object.isFrozen(snap)).toBe(true)
  })

  test('subscribeToCommandQueue fires on enqueue', () => {
    let calls = 0
    const unsubscribe = subscribeToCommandQueue(() => { calls++ })
    enqueueCommand(cmd('a'))
    expect(calls).toBe(1)
    enqueueCommand(cmd('b'))
    expect(calls).toBe(2)
    unsubscribe()
  })

  test('subscribeToCommandQueue fires on drain', () => {
    enqueueCommand(cmd('a'))
    let calls = 0
    const unsubscribe = subscribeToCommandQueue(() => { calls++ })
    drainAllCommands()
    expect(calls).toBe(1)
    unsubscribe()
  })

  test('subscribeToCommandQueue fires on clear only when non-empty', () => {
    let calls = 0
    const unsubscribe = subscribeToCommandQueue(() => { calls++ })
    clearCommandQueue()
    expect(calls).toBe(0)
    enqueueCommand(cmd('a'))
    expect(calls).toBe(1)
    clearCommandQueue()
    expect(calls).toBe(2)
    unsubscribe()
  })

  test('drainAllCommands on empty queue does not notify subscribers', () => {
    let calls = 0
    const unsubscribe = subscribeToCommandQueue(() => { calls++ })
    drainAllCommands()
    expect(calls).toBe(0)
    unsubscribe()
  })
})
