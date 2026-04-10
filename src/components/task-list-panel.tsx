// ---------------------------------------------------------------------------
// TaskListPanel — shows current tasks above the prompt area
//
// Renders when tasks exist. Each task is a single line:
//   status-icon subject (owner)
//
// Status icons:
//   ○  pending
//   ◉  in_progress (shows activeForm text if set)
//   ✓  completed
// ---------------------------------------------------------------------------

import { Box, Text } from '../ink.js'
import { useTaskList } from '../hooks/useTaskList.js'
import type { Task, TaskStatus } from '../services/tasks/index.js'

const STATUS_ICON: Record<TaskStatus, { icon: string; color: string }> = {
  pending:     { icon: '○', color: 'gray' },
  in_progress: { icon: '◉', color: 'yellow' },
  completed:   { icon: '✓', color: 'green' },
}

function TaskRow({ task }: { task: Task }) {
  const cfg = STATUS_ICON[task.status]
  const label = task.status === 'in_progress' && task.activeForm
    ? task.activeForm
    : task.subject

  return (
    <Text>
      <Text color={cfg.color}>{cfg.icon}</Text>
      {' '}
      <Text dimColor={task.status === 'completed'}>{label}</Text>
      {task.owner && <Text color="gray">{` (${task.owner})`}</Text>}
    </Text>
  )
}

export function TaskListPanel() {
  const tasks = useTaskList()

  if (tasks.length === 0) return null

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <Text bold color="cyan">Tasks</Text>
      {tasks.map(t => (
        <TaskRow key={t.id} task={t} />
      ))}
    </Box>
  )
}
