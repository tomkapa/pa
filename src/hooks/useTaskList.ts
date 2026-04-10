// React adapter for the module-level task list.
//
// Subscribes to onTasksUpdated and re-reads tasks from disk on each
// signal. Tasks are tiny JSON files (~1KB each, <10 per session) so
// the disk I/O on every mutation is negligible.
//
// A monotonic version counter guards against stale async results
// overwriting fresh ones when signals fire in rapid succession.

import { useState, useEffect } from 'react'
import {
  onTasksUpdated,
  listTasks,
  getTaskListId,
  type Task,
} from '../services/tasks/index.js'
import { logForDebugging } from '../services/observability/debug.js'

function tasksEqual(a: readonly Task[], b: readonly Task[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ta = a[i]!
    const tb = b[i]!
    if (
      ta.id !== tb.id ||
      ta.status !== tb.status ||
      ta.subject !== tb.subject ||
      ta.owner !== tb.owner ||
      ta.activeForm !== tb.activeForm
    ) return false
  }
  return true
}

export function useTaskList(): readonly Task[] {
  const [tasks, setTasks] = useState<readonly Task[]>([])

  useEffect(() => {
    let version = 0

    const load = () => {
      const thisVersion = ++version
      void listTasks(getTaskListId()).then(result => {
        if (thisVersion === version) {
          setTasks(prev => tasksEqual(prev, result) ? prev : result)
        }
      }).catch((err: unknown) => {
        logForDebugging(`useTaskList: failed to read tasks — ${err instanceof Error ? err.message : String(err)}`, { level: 'warn' })
      })
    }

    load()
    return onTasksUpdated(load)
  }, [])

  return tasks
}
