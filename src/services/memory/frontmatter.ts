// ---------------------------------------------------------------------------
// Frontmatter Parser
//
// Markdown files in .claude/rules/ may begin with YAML frontmatter delimited
// by `---` lines. Only the `paths:` field is meaningful in v1 — it makes a
// rule "conditional" so it only loads when the agent touches a matching path.
//
// `paths:` accepts a YAML list (`- src/**/*.ts`) or a comma-separated string
// (`src/*.ts, test/*.ts`). Brace expansion is also supported:
// `src/*.{ts,tsx}` → ['src/*.ts', 'src/*.tsx'].
// ---------------------------------------------------------------------------

import { parse as parseYaml } from 'yaml'

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/

export interface ParsedFrontmatter {
  /** Parsed YAML frontmatter (empty object if none was present). */
  frontmatter: Record<string, unknown>
  /** Markdown content with the frontmatter block stripped. */
  content: string
}

/**
 * Parse a YAML frontmatter block from the start of a markdown string.
 *
 * If the file does not begin with a `---` fence, returns `{ frontmatter: {}, content }`.
 * If the YAML is malformed, the frontmatter object is empty but the fence is
 * still stripped from the content (so it doesn't leak into the prompt).
 */
export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const match = FRONTMATTER_RE.exec(markdown)
  if (!match) {
    return { frontmatter: {}, content: markdown }
  }

  const yamlText = match[1] ?? ''
  const content = markdown.slice(match[0].length)

  let frontmatter: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(yamlText)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>
    }
  } catch {
    // Malformed YAML — keep frontmatter empty but strip the fence anyway.
    frontmatter = {}
  }

  return { frontmatter, content }
}

/**
 * Extract glob patterns from the `paths:` frontmatter field.
 *
 * Accepts:
 *   - A YAML list:           paths: ['src/*.ts', 'test/*.ts']
 *   - A comma-separated str: paths: 'src/*.ts, test/*.ts'
 *   - A single string:       paths: 'src/**\/*.ts'
 *
 * Returns `undefined` (NOT an empty array) when no `paths:` field is set.
 * That distinction matters: empty array means "matches nothing", undefined
 * means "unconditional, always loaded".
 *
 * Brace expansion is applied to every pattern:
 *   `src/*.{ts,tsx}` → ['src/*.ts', 'src/*.tsx']
 */
export function extractGlobs(frontmatter: Record<string, unknown>): string[] | undefined {
  if (!('paths' in frontmatter)) {
    return undefined
  }
  const raw = frontmatter['paths']
  const patterns: string[] = []

  if (typeof raw === 'string') {
    for (const piece of splitRespectingBraces(raw)) {
      const trimmed = piece.trim()
      if (trimmed.length > 0) patterns.push(trimmed)
    }
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' && item.trim().length > 0) {
        patterns.push(item.trim())
      }
    }
  } else {
    // Unknown shape — treat as empty (matches nothing).
    return []
  }

  const expanded: string[] = []
  for (const pattern of patterns) {
    expanded.push(...expandBraces(pattern))
  }
  return expanded
}

/**
 * Split a comma-separated string, treating commas inside `{...}` as brace
 * alternatives rather than separators.
 *
 * `src/*.{ts,tsx}, test/*.ts` → ['src/*.{ts,tsx}', ' test/*.ts']
 */
export function splitRespectingBraces(input: string): string[] {
  const result: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      if (depth > 0) depth--
    } else if (ch === ',' && depth === 0) {
      result.push(input.slice(start, i))
      start = i + 1
    }
  }
  result.push(input.slice(start))
  return result
}

/**
 * Hard cap on the number of patterns produced by a single brace expansion.
 *
 * Cross-product expansion can blow up exponentially: `{a,b}{c,d}{e,f}...` with
 * N pairs produces 2^N strings. The cap protects us from a malicious or
 * sloppy `paths:` frontmatter that would otherwise consume unbounded memory.
 */
export const MAX_BRACE_EXPANSIONS = 1024

/**
 * Expand brace patterns into a list of literal strings.
 *
 *   src/*.{ts,tsx}      → ['src/*.ts', 'src/*.tsx']
 *   {a,b}/{c,d}         → ['a/c', 'a/d', 'b/c', 'b/d']
 *   a{b,c{d,e}}         → ['ab', 'acd', 'ace']
 *   no-braces.txt       → ['no-braces.txt']
 *
 * Outermost braces are expanded first so each alternative is a complete
 * subtree, then we recurse into each alternative. Unmatched braces pass
 * through unchanged so we never crash on malformed input. Expansion stops
 * once {@link MAX_BRACE_EXPANSIONS} patterns have been produced.
 */
export function expandBraces(pattern: string): string[] {
  const results: string[] = []
  expandBracesInto(pattern, results)
  return results
}

function expandBracesInto(pattern: string, out: string[]): void {
  if (out.length >= MAX_BRACE_EXPANSIONS) return

  // Find the first OUTERMOST balanced {...}.
  const open = pattern.indexOf('{')
  if (open === -1) {
    out.push(pattern)
    return
  }

  // Walk forward to find the matching close brace at the same depth.
  let depth = 0
  let close = -1
  for (let i = open; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close === -1) {
    // Unbalanced — treat as literal so malformed input never crashes.
    out.push(pattern)
    return
  }

  const before = pattern.slice(0, open)
  const after = pattern.slice(close + 1)
  const inside = pattern.slice(open + 1, close)

  // Split inside on top-level commas only — nested braces stay together.
  const alternatives = splitTopLevelCommas(inside)

  for (const alt of alternatives) {
    if (out.length >= MAX_BRACE_EXPANSIONS) return
    // Recurse so braces inside the alt or after the close are expanded too.
    expandBracesInto(before + alt + after, out)
  }
}

/**
 * Split a string on commas that are NOT inside nested `{...}` groups.
 * Used by expandBraces to keep nested groups together.
 */
function splitTopLevelCommas(input: string): string[] {
  const result: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      if (depth > 0) depth--
    } else if (ch === ',' && depth === 0) {
      result.push(input.slice(start, i))
      start = i + 1
    }
  }
  result.push(input.slice(start))
  return result
}
