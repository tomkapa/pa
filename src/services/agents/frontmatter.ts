import {
  parseFrontmatterTrimmed,
  normalizeToolList,
} from '../memory/frontmatter.js'

export { normalizeToolList }

export interface AgentFrontmatter {
  name?: string
  description?: string
  tools?: string | string[]
  disallowedTools?: string | string[]
  model?: string
}

export interface ParsedAgent {
  frontmatter: AgentFrontmatter
  content: string
}

/**
 * Parse YAML frontmatter from an agent markdown file.
 *
 * Delegates to the shared frontmatter parser with content trimming,
 * then narrows the untyped record to `AgentFrontmatter`.
 */
export function parseAgentFrontmatter(raw: string): ParsedAgent {
  const { frontmatter, content } = parseFrontmatterTrimmed(raw)
  return { frontmatter: frontmatter as AgentFrontmatter, content }
}
