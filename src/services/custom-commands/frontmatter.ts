import { parseFrontmatterTrimmed } from '../memory/frontmatter.js'

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
 * Delegates to the shared frontmatter parser with content trimming,
 * then narrows the untyped record to `CommandFrontmatter`.
 */
export function parseFrontmatter(raw: string): ParsedCommand {
  const { frontmatter, content } = parseFrontmatterTrimmed(raw)
  return { frontmatter: frontmatter as CommandFrontmatter, content }
}
