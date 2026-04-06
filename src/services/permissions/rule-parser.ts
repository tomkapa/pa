import type { PermissionRuleValue } from './types.js'

/**
 * Parse a permission rule string into a PermissionRuleValue.
 *
 * Format: `ToolName` or `ToolName(content)`
 * - Parentheses in content are escaped: `Bash(python -c "print\(1\)")`
 * - Empty content `Bash()` and wildcard-only `Bash(*)` are treated as tool-level rules
 */
export function permissionRuleValueFromString(raw: string): PermissionRuleValue {
  const trimmed = raw.trim()

  // Find the first unescaped opening paren
  const openIndex = findFirstUnescapedParen(trimmed, '(')
  if (openIndex === -1) {
    return { toolName: trimmed }
  }

  // Find the last unescaped closing paren
  const closeIndex = findLastUnescapedParen(trimmed, ')')
  if (closeIndex === -1 || closeIndex <= openIndex) {
    // Malformed — treat entire string as tool name
    return { toolName: trimmed }
  }

  const toolName = trimmed.slice(0, openIndex).trim()
  const rawContent = trimmed.slice(openIndex + 1, closeIndex).trim()

  // Empty content or wildcard-only → tool-level rule
  if (rawContent === '' || rawContent === '*') {
    return { toolName }
  }

  // Unescape parentheses in content
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
