import { parseFrontmatterTrimmed } from '../memory/frontmatter.js'

export interface CommandFrontmatter {
  description?: string
  'argument-hint'?: string
  'allowed-tools'?: string | string[]
  model?: string
  arguments?: string | string[]
  // Skill-specific fields
  name?: string
  'when_to_use'?: string
  'when-to-use'?: string
  'user-invocable'?: string
  'disable-model-invocation'?: string
  effort?: string
  version?: string
}

export type EffortValue = 'low' | 'medium' | 'high' | 'max'

export interface ParsedSkillFields {
  nameOverride?: string
  whenToUse?: string
  userInvocable: boolean
  disableModelInvocation: boolean
  effort?: EffortValue
  version?: string
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

/**
 * Parse a boolean-string frontmatter value with a default.
 * Accepts "true"/"false" (case-insensitive). Unrecognised values
 * fall back to the default.
 */
function parseBooleanString(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue
  const s = String(value).toLowerCase().trim()
  if (s === 'true') return true
  if (s === 'false') return false
  return defaultValue
}

/**
 * Parse the effort field into one of the named levels.
 */
function parseEffort(value: unknown): EffortValue | undefined {
  if (!value) return undefined
  const s = String(value).toLowerCase().trim()
  if (s === 'low' || s === 'medium' || s === 'high' || s === 'max') return s
  return undefined
}

/**
 * Extract skill-specific fields from parsed frontmatter.
 * Reuses the same frontmatter object that `parseFrontmatter` returns.
 */
export function parseSkillFields(fm: CommandFrontmatter): ParsedSkillFields {
  return {
    nameOverride: fm.name,
    whenToUse: (fm['when_to_use'] ?? fm['when-to-use']) as string | undefined,
    userInvocable: parseBooleanString(fm['user-invocable'], true),
    disableModelInvocation: parseBooleanString(fm['disable-model-invocation'], false),
    effort: parseEffort(fm.effort),
    version: fm.version,
  }
}
