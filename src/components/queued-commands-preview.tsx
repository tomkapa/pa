// Renders the queued-commands preview below the prompt. Each queued message
// appears as a dim row with a `↳` prefix so the user can see their typing
// landed somewhere while the agent is still mid-turn.
import { Box, Text } from '../ink.js'
import { useCommandQueue } from '../hooks/useCommandQueue.js'

export function QueuedCommandsPreview() {
  const queue = useCommandQueue()
  if (queue.length === 0) return null

  return (
    <Box flexDirection="column" marginTop={1}>
      {queue.map(cmd => (
        <Text key={cmd.uuid} dimColor>{`↳ ${cmd.value}`}</Text>
      ))}
    </Box>
  )
}
