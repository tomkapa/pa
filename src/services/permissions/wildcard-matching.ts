// ---------------------------------------------------------------------------
// Wildcard Pattern Matching for Shell Command Permission Rules
//
// Custom regex-based matching — NOT filesystem globs. Shell command patterns
// have different semantics:
//   - `*` matches any sequence of characters (like regex `.*`)
//   - `\*` is an escaped literal asterisk
//   - `\\` is an escaped literal backslash
//   - Trailing ` *` (space+wildcard) is optional — `git *` matches `git` alone
//
// Uses null-byte sentinels for escape placeholders (shell commands never
// contain null bytes).
// ---------------------------------------------------------------------------

const ESCAPED_STAR = '\x00ESCAPED_STAR\x00'
const ESCAPED_BACKSLASH = '\x00ESCAPED_BACKSLASH\x00'

// Pre-compiled regexes for sentinel replacement (avoid re-creating per call)
const ESCAPED_STAR_RE = new RegExp(escapeRegex(ESCAPED_STAR), 'g')
const ESCAPED_BACKSLASH_RE = new RegExp(escapeRegex(ESCAPED_BACKSLASH), 'g')

// Cache compiled regexes — patterns are stable after rule loading
const regexCache = new Map<string, RegExp>()

/**
 * Match an input string against a wildcard pattern.
 *
 * @param input - The actual command string to test
 * @param pattern - The pattern string (may contain `*` wildcards)
 * @param caseInsensitive - If true, match case-insensitively (for PowerShell)
 * @returns true if the input matches the pattern
 */
export function matchWildcardPattern(
  input: string,
  pattern: string,
  caseInsensitive = false,
): boolean {
  const cacheKey = caseInsensitive ? `${pattern}\x01i` : pattern
  let regex = regexCache.get(cacheKey)
  if (!regex) {
    regex = buildWildcardRegex(pattern, caseInsensitive)
    regexCache.set(cacheKey, regex)
  }
  return regex.test(input)
}

/**
 * Check if a rule content uses the legacy `:*` prefix syntax.
 * `npm:*` matches `npm` or `npm <anything>`.
 */
export function matchLegacyPrefix(
  input: string,
  ruleContent: string,
): boolean {
  if (!ruleContent.endsWith(':*')) return false

  const prefix = ruleContent.slice(0, -2)
  return input === prefix || input.startsWith(prefix + ' ')
}

/**
 * Check if a wildcard pattern contains any unescaped wildcards.
 */
export function hasWildcard(pattern: string): boolean {
  const withoutEscaped = pattern.replace(/\\\*/g, '')
  return withoutEscaped.includes('*')
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function buildWildcardRegex(pattern: string, caseInsensitive: boolean): RegExp {
  let regexStr = pattern
    .replace(/\\\\/g, ESCAPED_BACKSLASH)
    .replace(/\\\*/g, ESCAPED_STAR)

  regexStr = regexStr.replace(/[.+?^${}()|[\]]/g, '\\$&')

  if (regexStr.endsWith(' *')) {
    regexStr = regexStr.slice(0, -2)
    regexStr = regexStr.replace(/\*/g, '.*')
    regexStr += '( .*)?'
  } else {
    regexStr = regexStr.replace(/\*/g, '.*')
  }

  regexStr = regexStr
    .replace(ESCAPED_STAR_RE, '\\*')
    .replace(ESCAPED_BACKSLASH_RE, '\\\\')

  const flags = 's' + (caseInsensitive ? 'i' : '')
  return new RegExp(`^${regexStr}$`, flags)
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
