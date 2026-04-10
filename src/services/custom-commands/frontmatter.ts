import { parseFrontmatter as parseRawFrontmatter } from '../memory/frontmatter.js'

export interface CommandFrontmatter {
  description?: string
  'argument-hint'?: string
  'allowed-tools'?: string | string[]
  model?: string
  arguments?: string | string[]
}

export interface ParsedCommand {
  frontmatter: CommandFrontmatter
  content: string
}

/**
 * Parse YAML frontmatter from a command markdown file.
 *
 * Delegates to the shared frontmatter parser in `services/memory/frontmatter.ts`,
 * then narrows the untyped `Record<string, unknown>` to the command-specific
 * `CommandFrontmatter` shape.
 */
export function parseFrontmatter(raw: string): ParsedCommand {
  const { frontmatter, content } = parseRawFrontmatter(raw)
  // The shared parser preserves the blank separator line between the closing
  // --- and the content body. For commands, strip it so the prompt doesn't
  // start with a stray newline. Handle both \n and \r\n.
  const trimmedContent = content.startsWith('\r\n')
    ? content.slice(2)
    : content.startsWith('\n')
      ? content.slice(1)
      : content
  return {
    frontmatter: frontmatter as CommandFrontmatter,
    content: trimmedContent,
  }
}
