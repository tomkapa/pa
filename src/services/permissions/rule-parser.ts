import type { PermissionRuleValue } from './types.js'

// Cache parsed rules — rule strings are stable after initialization
const parseCache = new Map<string, PermissionRuleValue>()

/**
 * Parse a permission rule string into a PermissionRuleValue.
 *
 * Format: `ToolName` or `ToolName(content)`
 * - Parentheses in content are escaped: `Bash(python -c "print\(1\)")`
 * - Empty content `Bash()` and wildcard-only `Bash(*)` are treated as tool-level rules
 */
export function permissionRuleValueFromString(raw: string): PermissionRuleValue {
  const cached = parseCache.get(raw)
  if (cached) return cached

  const result = parseRuleValue(raw)
  parseCache.set(raw, result)
  return result
}

function parseRuleValue(raw: string): PermissionRuleValue {
  const trimmed = raw.trim()

  const openIndex = findFirstUnescapedParen(trimmed, '(')
  if (openIndex === -1) {
    return { toolName: trimmed }
  }

  const closeIndex = findLastUnescapedParen(trimmed, ')')
  if (closeIndex === -1 || closeIndex <= openIndex) {
    return { toolName: trimmed }
  }

  const toolName = trimmed.slice(0, openIndex).trim()
  const rawContent = trimmed.slice(openIndex + 1, closeIndex).trim()

  if (rawContent === '' || rawContent === '*') {
    return { toolName }
  }

  const ruleContent = rawContent.replace(/\\\(/g, '(').replace(/\\\)/g, ')')

  return { toolName, ruleContent }
}

/**
 * Serialize a PermissionRuleValue back to its string format.
 */
export function permissionRuleValueToString(value: PermissionRuleValue): string {
  if (value.ruleContent === undefined) {
    return value.toolName
  }

  // Escape parentheses in content
  const escaped = value.ruleContent.replace(/\(/g, '\\(').replace(/\)/g, '\\)')

  return `${value.toolName}(${escaped})`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findFirstUnescapedParen(s: string, paren: '(' | ')'): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === paren && (i === 0 || s[i - 1] !== '\\')) {
      return i
    }
  }
  return -1
}

function findLastUnescapedParen(s: string, paren: '(' | ')'): number {
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === paren && (i === 0 || s[i - 1] !== '\\')) {
      return i
    }
  }
  return -1
}
