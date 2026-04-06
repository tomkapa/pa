// ---------------------------------------------------------------------------
// Permission Rule Validation
//
// Validates permission rule strings for correctness and provides
// actionable error messages with suggestions.
// ---------------------------------------------------------------------------

import { hasWildcard } from './wildcard-matching.js'
import { FILE_PATTERN_TOOLS, BASH_PREFIX_TOOLS } from './tool-classification.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RuleValidationResult {
  valid: boolean
  error?: string
  suggestion?: string
  examples?: string[]
}

// ---------------------------------------------------------------------------
// Main validation function
// ---------------------------------------------------------------------------

/**
 * Validate a permission rule string.
 *
 * Checks (in order):
 * 1. Non-empty
 * 2. Balanced parentheses
 * 3. Empty parentheses warning
 * 4. Tool name format (uppercase or MCP)
 * 5. MCP rule format
 * 6. Tool-specific validation
 */
export function validatePermissionRule(rule: string): RuleValidationResult {
  const trimmed = rule.trim()

  // 1. Non-empty
  if (trimmed === '') {
    return {
      valid: false,
      error: 'Permission rule cannot be empty',
      examples: ['Bash', 'Read(src/**/*.ts)', 'Bash(git status)'],
    }
  }

  // Check for MCP format first (starts with lowercase "mcp__")
  if (trimmed.startsWith('mcp_')) {
    return validateMcpRule(trimmed)
  }

  // 4. Tool name format — must start with uppercase letter
  if (!/^[A-Z]/.test(trimmed)) {
    const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
    return {
      valid: false,
      error: `Tool name must start with an uppercase letter: "${trimmed}"`,
      suggestion: capitalized,
    }
  }

  // 2. Balanced parentheses
  const parenCheck = checkParentheses(trimmed)
  if (parenCheck) return parenCheck

  // Extract tool name and content
  const openIndex = trimmed.indexOf('(')
  if (openIndex === -1) {
    // Tool-level rule (no parentheses) — valid
    return { valid: true }
  }

  const toolName = trimmed.slice(0, openIndex).trim()
  const closeIndex = trimmed.lastIndexOf(')')
  const content = trimmed.slice(openIndex + 1, closeIndex).trim()

  // 3. Empty parentheses
  if (content === '') {
    return {
      valid: false,
      error: `Empty parentheses in rule "${trimmed}" — did you mean the tool-level rule?`,
      suggestion: toolName,
      examples: [toolName, `${toolName}(command)`, `${toolName}(pattern)`],
    }
  }

  // 6. Tool-specific validation
  return validateToolSpecific(toolName, content)
}

// ---------------------------------------------------------------------------
// MCP rule validation
// ---------------------------------------------------------------------------

function validateMcpRule(rule: string): RuleValidationResult {
  // Must start with mcp__ (double underscore)
  if (!rule.startsWith('mcp__')) {
    return {
      valid: false,
      error: `Invalid MCP rule format: "${rule}" — must use double underscore (mcp__server)`,
      suggestion: rule.replace(/^mcp_/, 'mcp__'),
      examples: ['mcp__server1', 'mcp__server1__tool1'],
    }
  }

  // No parenthesized content allowed for MCP rules
  if (rule.includes('(')) {
    return {
      valid: false,
      error: `MCP rules do not support parenthesized content: "${rule}"`,
      suggestion: rule.slice(0, rule.indexOf('(')),
      examples: ['mcp__server1', 'mcp__server1__tool1'],
    }
  }

  // Must have a server name after mcp__
  const afterPrefix = rule.slice(5) // after "mcp__"
  if (afterPrefix === '') {
    return {
      valid: false,
      error: 'MCP rule must specify a server name: mcp__<server>',
      examples: ['mcp__server1', 'mcp__server1__tool1'],
    }
  }

  return { valid: true }
}

// ---------------------------------------------------------------------------
// Parentheses checking
// ---------------------------------------------------------------------------

function checkParentheses(rule: string): RuleValidationResult | undefined {
  let depth = 0
  for (let i = 0; i < rule.length; i++) {
    if (rule[i] === '\\') { i++; continue } // skip escaped
    if (rule[i] === '(') depth++
    if (rule[i] === ')') depth--
    if (depth < 0) {
      return {
        valid: false,
        error: `Unbalanced parentheses in rule: "${rule}" — extra closing parenthesis`,
      }
    }
  }

  if (depth > 0) {
    return {
      valid: false,
      error: `Unbalanced parentheses in rule: "${rule}" — missing closing parenthesis`,
      suggestion: rule + ')',
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Tool-specific validation
// ---------------------------------------------------------------------------

function validateToolSpecific(
  toolName: string,
  content: string,
): RuleValidationResult {
  // Bash/PowerShell: support :* and wildcard patterns
  if (BASH_PREFIX_TOOLS.has(toolName)) {
    return validateBashContent(toolName, content)
  }

  // File tools: support gitignore-style globs
  if (FILE_PATTERN_TOOLS.has(toolName)) {
    return validateFileToolContent(toolName, content)
  }

  // WebSearch: no wildcards
  if (toolName === 'WebSearch') {
    if (hasWildcard(content)) {
      return {
        valid: false,
        error: `WebSearch rules do not support wildcard patterns: "${content}"`,
        examples: ['WebSearch', 'WebSearch(exact query)'],
      }
    }
    return { valid: true }
  }

  // WebFetch: must use domain: prefix
  if (toolName === 'WebFetch') {
    if (!content.startsWith('domain:')) {
      return {
        valid: false,
        error: `WebFetch rules must use the "domain:" prefix format: "${content}"`,
        suggestion: `WebFetch(domain:${content})`,
        examples: ['WebFetch(domain:example.com)', 'WebFetch(domain:*.github.com)'],
      }
    }
    return { valid: true }
  }

  // Unknown tool — valid if format is correct (could be a plugin tool)
  return { valid: true }
}

function validateBashContent(
  toolName: string,
  content: string,
): RuleValidationResult {
  // Check :* legacy prefix — must be at end only
  const colonStarIndex = content.indexOf(':*')
  if (colonStarIndex !== -1 && colonStarIndex !== content.length - 2) {
    return {
      valid: false,
      error: `Legacy ":*" prefix in "${toolName}(${content})" must be at the end of the pattern`,
      suggestion: `${toolName}(${content.slice(0, colonStarIndex)}:*)`,
      examples: [`${toolName}(npm:*)`, `${toolName}(git:*)`],
    }
  }

  return { valid: true }
}

function validateFileToolContent(
  toolName: string,
  content: string,
): RuleValidationResult {
  // File tools should use glob patterns, not :* syntax
  if (content.endsWith(':*')) {
    return {
      valid: false,
      error: `File tool "${toolName}" uses glob patterns, not ":*" prefix syntax`,
      suggestion: `${toolName}(${content.slice(0, -2)}/**)`,
      examples: [`${toolName}(src/**/*.ts)`, `${toolName}(*.json)`, `${toolName}(config/**)`],
    }
  }

  return { valid: true }
}
