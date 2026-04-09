// React adapter for the module-level command queue.
//
// useSyncExternalStore gives us concurrent-rendering-safe subscription to a
// non-React data source. The store-side contract (stable snapshot reference
// between mutations) lives in utils/messageQueue.ts.
import { useSyncExternalStore } from 'react'
import {
  subscribeToCommandQueue,
  getQueueSnapshot,
} from '../utils/messageQueue.js'
import type { QueuedCommand } from '../types/queue.js'

export function useCommandQueue(): readonly QueuedCommand[] {
  return useSyncExternalStore(subscribeToCommandQueue, getQueueSnapshot)
}
