// Module-level FIFO queue for user messages submitted while the agent is
// mid-turn. React consumes it via useSyncExternalStore; the rest of the
// process reads/writes it directly.
//
// Why module-level and not React state:
//   - The submit handler needs to synchronously decide enqueue vs immediate
//     execute based on agent busy state. React state is one render behind.
//   - Future non-React consumers (headless mode, SDK harness, remote bridge)
//     need to read the same queue without going through a provider tree.
//
// Snapshot stability contract:
//   getQueueSnapshot() MUST return the same frozen array reference between
//   mutations. useSyncExternalStore compares snapshots by Object.is and will
//   warn or loop forever if the reference changes on every call. The snapshot
//   is recomputed inside notify(), not inside the getter.

import { createSignal } from './signal.js'
import type { QueuedCommand } from '../types/queue.js'

const queue: QueuedCommand[] = []
let snapshot: readonly QueuedCommand[] = Object.freeze<QueuedCommand[]>([])
const changed = createSignal()

function notify(): void {
  snapshot = Object.freeze([...queue])
  changed.emit()
}

export const subscribeToCommandQueue = changed.subscribe

export function getQueueSnapshot(): readonly QueuedCommand[] {
  return snapshot
}

export function enqueueCommand(cmd: QueuedCommand): void {
  queue.push(cmd)
  notify()
}

/** FIFO drain. Returns the dequeued items, or [] if empty. */
export function drainAllCommands(): QueuedCommand[] {
  if (queue.length === 0) return []
  const drained = queue.splice(0, queue.length)
  notify()
  return drained
}

export function clearCommandQueue(): void {
  if (queue.length === 0) return
  queue.length = 0
  notify()
}

export function hasQueuedCommands(): boolean {
  return queue.length > 0
}

/**
 * Test-only: reset the module-level state. Not exported from a barrel file;
 * tests import directly from this module.
 */
export function __resetCommandQueueForTests(): void {
  queue.length = 0
  snapshot = Object.freeze<QueuedCommand[]>([])
  changed.emit()
}
