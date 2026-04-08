import { Box, Text } from '../ink.js'

interface ThinkingBlockProps {
  /** Accumulated thinking text so far. */
  content: string
  /** True until the matching `content_block_stop` finalizes the block. */
  isStreaming: boolean
}

/**
 * Inline display for an assistant `thinking` content block.
 *
 * Visual choices:
 * - Dim italic text differentiates reasoning from user/assistant content
 *   without competing with tool output for attention.
 * - The `∴` (therefore) prefix is a single distinctive character that
 *   scans cleanly even in dense terminals.
 * - "Thinking…" → "Thought" is a tiny tense flip when the stream finalizes.
 *
 * Markdown rendering inside thinking is intentionally not handled — code
 * blocks and lists render as plain text. That's a follow-up enhancement.
 */
export function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  if (content.length === 0 && !isStreaming) return null
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor italic>
        {isStreaming ? '∴ Thinking…' : '∴ Thought'}
      </Text>
      {content.length > 0 && (
        <Box paddingLeft={2}>
          <Text dimColor italic>{content}</Text>
        </Box>
      )}
    </Box>
  )
}
