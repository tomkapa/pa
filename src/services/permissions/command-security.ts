// ---------------------------------------------------------------------------
// Bash Command Security Hardening
//
// Defense-in-depth layers for shell command permission checking:
//   Layer 1: Compound command splitting (decompose into simple commands)
//   Layer 2: Env var & wrapper stripping (normalize for matching)
//   Layer 3: Per-subcommand permission checking (check each part independently)
//   Layer 4: Dangerous pattern detection (catch injection patterns)
//   Layer 5: Deny rule priority (deny checked on FULL command AND per-subcommand)
//
// Fail-closed: if something can't be parsed, it triggers 'ask'.
// ---------------------------------------------------------------------------

import type { PermissionRuleSource, RulesBySource } from './types.js'
import { permissionRuleValueFromString } from './rule-parser.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EnvVarStripMode = 'safe-only' | 'all'

export interface BashSecurityResult {
  behavior: 'passthrough' | 'ask' | 'deny'
  reason?: string
  matchedRule?: string
  matchedSource?: PermissionRuleSource
}

export interface BashAllowResult {
  matched: boolean
  source?: PermissionRuleSource
  ruleString?: string
}

// ---------------------------------------------------------------------------
// Layer 1: Compound Command Splitting
// ---------------------------------------------------------------------------

type QuoteState = 'none' | 'single' | 'double' | 'backtick' | 'command-sub' | 'arith'

export function splitCompoundCommand(command: string): string[] {
  const parts: string[] = []
  let current = ''
  const stateStack: QuoteState[] = ['none']
  let i = 0

  while (i < command.length) {
    const ch = command[i]
    const next = i + 1 < command.length ? command[i + 1] : ''
    const state = stateStack[stateStack.length - 1]

    // Backslash escapes (only in none and double-quote contexts)
    if ((state === 'none' || state === 'double') && ch === '\\' && i + 1 < command.length) {
      current += ch + command[i + 1]
      i += 2
      continue
    }

    switch (state) {
      case 'none':
        if (ch === "'") { stateStack.push('single'); current += ch; i++; continue }
        if (ch === '"') { stateStack.push('double'); current += ch; i++; continue }
        if (ch === '`') { stateStack.push('backtick'); current += ch; i++; continue }
        if (ch === '$' && next === '(') {
          if (i + 2 < command.length && command[i + 2] === '(') {
            stateStack.push('arith'); current += '$((' ; i += 3; continue
          }
          stateStack.push('command-sub'); current += '$(' ; i += 2; continue
        }
        // Operator splitting
        if (ch === '&' && next === '&') { pushPart(parts, current); current = ''; i += 2; continue }
        if (ch === '|' && next === '|') { pushPart(parts, current); current = ''; i += 2; continue }
        if (ch === '|' && next === '&') { pushPart(parts, current); current = ''; i += 2; continue }
        if (ch === '|') { pushPart(parts, current); current = ''; i++; continue }
        if (ch === ';') { pushPart(parts, current); current = ''; i++; continue }
        break

      case 'single':
        if (ch === "'") { stateStack.pop(); current += ch; i++; continue }
        break

      case 'double':
        if (ch === '"') { stateStack.pop(); current += ch; i++; continue }
        if (ch === '$' && next === '(') {
          if (i + 2 < command.length && command[i + 2] === '(') {
            stateStack.push('arith'); current += '$((' ; i += 3; continue
          }
          stateStack.push('command-sub'); current += '$(' ; i += 2; continue
        }
        break

      case 'backtick':
        if (ch === '`') { stateStack.pop(); current += ch; i++; continue }
        break

      case 'command-sub':
        if (ch === ')') { stateStack.pop(); current += ch; i++; continue }
        if (ch === "'") { stateStack.push('single'); current += ch; i++; continue }
        if (ch === '"') { stateStack.push('double'); current += ch; i++; continue }
        if (ch === '`') { stateStack.push('backtick'); current += ch; i++; continue }
        if (ch === '$' && next === '(') {
          if (i + 2 < command.length && command[i + 2] === '(') {
            stateStack.push('arith'); current += '$((' ; i += 3; continue
          }
          stateStack.push('command-sub'); current += '$(' ; i += 2; continue
        }
        break

      case 'arith':
        if (ch === ')' && next === ')') { stateStack.pop(); current += '))' ; i += 2; continue }
        break
    }

    current += ch
    i++
  }

  pushPart(parts, current)
  return parts
}

function pushPart(parts: string[], raw: string): void {
  const trimmed = raw.trim()
  if (trimmed) {
    parts.push(trimmed)
  }
}

// ---------------------------------------------------------------------------
// Layer 2a: Env Var Prefix Stripping
// ---------------------------------------------------------------------------

const SAFE_ENV_VARS = new Set([
  // Node/JS
  'NODE_ENV', 'NODE_OPTIONS', 'NODE_PATH', 'NPM_CONFIG_LOGLEVEL',
  // Go
  'GOOS', 'GOARCH', 'GOPATH', 'GOBIN', 'CGO_ENABLED',
  // CI/Build
  'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS_URL',
  // Terminal/Display
  'FORCE_COLOR', 'NO_COLOR', 'TERM', 'COLORTERM', 'COLUMNS', 'LINES',
  // Debugging
  'DEBUG', 'VERBOSE', 'LOG_LEVEL',
  // Common safe
  'HOME', 'USER', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  // Rust
  'CARGO_HOME', 'RUSTFLAGS',
  // Python
  'PYTHONDONTWRITEBYTECODE', 'PYTHONUNBUFFERED', 'VIRTUAL_ENV',
])

const ENV_VAR_PATTERN = /^([A-Z_][A-Z0-9_]*)=((?:[^ \t\\]|\\.)*|"(?:[^"\\]|\\.)*"|'[^']*')[ \t]+/

export function stripLeadingEnvVars(
  command: string,
  mode: EnvVarStripMode,
): string {
  let stripped = command
  for (;;) {
    const match = stripped.match(ENV_VAR_PATTERN)
    if (!match) break
    if (mode === 'safe-only' && !SAFE_ENV_VARS.has(match[1])) break
    stripped = stripped.slice(match[0].length)
  }
  return stripped
}

// ---------------------------------------------------------------------------
// Layer 2b: Safe Wrapper Stripping
// ---------------------------------------------------------------------------

const SAFE_WRAPPERS: ReadonlyMap<string, 'skipFlags' | number> = new Map([
  ['timeout', 1],
  ['time', 0],
  ['nice', 'skipFlags'],
  ['nohup', 0],
  ['env', 0],
])

export function stripSafeWrappers(command: string): string {
  let result = command
  let changed = true

  while (changed) {
    changed = false
    const trimmed = result.trimStart()
    const firstSpace = trimmed.indexOf(' ')

    if (firstSpace === -1) break

    const firstWord = trimmed.slice(0, firstSpace)
    const wrapperSpec = SAFE_WRAPPERS.get(firstWord)

    if (wrapperSpec === undefined) break

    let rest = trimmed.slice(firstSpace).trimStart()

    if (typeof wrapperSpec === 'number') {
      for (let n = 0; n < wrapperSpec; n++) {
        const spaceIdx = rest.indexOf(' ')
        if (spaceIdx === -1) { rest = ''; break }
        rest = rest.slice(spaceIdx).trimStart()
      }
    } else {
      while (rest.startsWith('-')) {
        const spaceIdx = rest.indexOf(' ')
        if (spaceIdx === -1) { rest = ''; break }
        const flag = rest.slice(0, spaceIdx)
        rest = rest.slice(spaceIdx).trimStart()
        if ((flag === '-n' || flag === '-p') && rest && !rest.startsWith('-')) {
          const nextSpace = rest.indexOf(' ')
          if (nextSpace === -1) { rest = ''; break }
          rest = rest.slice(nextSpace).trimStart()
        }
      }
    }

    if (rest && rest !== result) {
      result = rest
      changed = true
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Combined Normalization
// ---------------------------------------------------------------------------

export function normalizeCommand(
  command: string,
  mode: EnvVarStripMode,
): string {
  let result = command
  let prev = ''

  while (result !== prev) {
    prev = result
    result = stripSafeWrappers(result)
    result = stripLeadingEnvVars(result, mode)
  }

  return result
}

// ---------------------------------------------------------------------------
// Layer 3: Prefix Matching with Word Boundary
// ---------------------------------------------------------------------------

export function matchesCommandPrefix(command: string, prefix: string): boolean {
  if (command === prefix) return true
  if (command.startsWith(prefix + ' ')) return true
  return false
}

// ---------------------------------------------------------------------------
// Layer 4: Dangerous Pattern Detection
// ---------------------------------------------------------------------------

const DANGEROUS_PATTERNS: ReadonlyArray<{ pattern: RegExp; description: string }> = [
  { pattern: /\$\([^)]*\)/, description: 'command substitution $(...)' },
  { pattern: /`[^`]+`/, description: 'backtick substitution' },
  { pattern: />\s*\/(?:etc|dev)/, description: 'redirect to sensitive path' },
  { pattern: /\beval\b/, description: 'eval command' },
  { pattern: /\bexec\b/, description: 'exec command' },
  { pattern: /\bsource\b/, description: 'source command' },
  { pattern: /(?:^|[;&|])\s*\.\s+\//, description: 'dot-source (. /script)' },
]

export function detectDangerousPatterns(command: string): string | undefined {
  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return description
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Heredoc & Line Continuation Detection
// ---------------------------------------------------------------------------

const HEREDOC_PATTERN = /<<-?\s*['"]?(\w+)['"]?/

export function detectHeredoc(command: string): boolean {
  return HEREDOC_PATTERN.test(command)
}

// Backslash-newline inside a word (not after whitespace) is suspicious
const SUSPICIOUS_CONTINUATION = /[^ \t\n\\]\\\n/

export function detectSuspiciousLineContinuation(command: string): boolean {
  return SUSPICIOUS_CONTINUATION.test(command)
}

export function joinLineContinuations(command: string): string {
  return command.replace(/\\\n/g, '')
}

// ---------------------------------------------------------------------------
// Shared rule iteration helper — eliminates duplicate parse+filter loops
// ---------------------------------------------------------------------------

interface ParsedRule {
  source: PermissionRuleSource
  ruleString: string
  ruleContent: string | undefined
}

/**
 * Iterate rules, parse each, filter by tool name, yield matches.
 * Centralizes the parse+filter logic used by deny and allow checking.
 */
function* iterBashRules(
  rulesBySource: Readonly<Partial<Record<string, readonly string[] | undefined>>>,
  toolName: string,
): Generator<ParsedRule> {
  for (const [source, rules] of Object.entries(rulesBySource)) {
    if (!rules) continue
    for (const ruleString of rules) {
      const parsed = permissionRuleValueFromString(ruleString)
      if (parsed.toolName !== toolName) continue
      yield { source: source as PermissionRuleSource, ruleString, ruleContent: parsed.ruleContent }
    }
  }
}

// ---------------------------------------------------------------------------
// Orchestrator: Security check (deny rules + dangerous patterns)
// ---------------------------------------------------------------------------

export function checkBashCommandSecurity(
  command: string,
  toolName: string,
  denyRulesBySource: RulesBySource,
): BashSecurityResult {
  // Layer 4c: Suspicious line continuation (check raw command first)
  if (detectSuspiciousLineContinuation(command)) {
    return { behavior: 'ask', reason: 'Command contains suspicious line continuation' }
  }

  // Layer 4b: Heredoc detection
  if (detectHeredoc(command)) {
    return { behavior: 'ask', reason: 'Command contains heredoc — needs manual review' }
  }

  // Layer 4: Dangerous pattern detection
  const dangerousPattern = detectDangerousPatterns(command)
  if (dangerousPattern) {
    return { behavior: 'ask', reason: `Command contains dangerous pattern: ${dangerousPattern}` }
  }

  // Layer 1: Split into subcommands
  const joined = joinLineContinuations(command)
  const subcommands = splitCompoundCommand(joined)

  // Layer 5: Deny rules — pre-normalize once, then check against each rule
  const fullNormalized = normalizeCommand(command, 'all')
  const normalizedSubs = subcommands.map(sub => normalizeCommand(sub, 'all'))

  for (const rule of iterBashRules(denyRulesBySource, toolName)) {
    // Tool-level deny (no content): matches everything
    if (rule.ruleContent === undefined) {
      return {
        behavior: 'deny',
        reason: `Denied by ${rule.source} rule: ${rule.ruleString}`,
        matchedRule: rule.ruleString,
        matchedSource: rule.source,
      }
    }

    // Check the full command
    if (matchesCommandPrefix(fullNormalized, rule.ruleContent)) {
      return {
        behavior: 'deny',
        reason: `Denied by ${rule.source} rule: ${rule.ruleString}`,
        matchedRule: rule.ruleString,
        matchedSource: rule.source,
      }
    }

    // Check each subcommand (deny on ANY match)
    for (const normalized of normalizedSubs) {
      if (matchesCommandPrefix(normalized, rule.ruleContent)) {
        return {
          behavior: 'deny',
          reason: `Subcommand denied by ${rule.source} rule: ${rule.ruleString}`,
          matchedRule: rule.ruleString,
          matchedSource: rule.source,
        }
      }
    }
  }

  return { behavior: 'passthrough' }
}

// ---------------------------------------------------------------------------
// Orchestrator: Allow-rule matching (compound-aware, prefix + word boundary)
// ---------------------------------------------------------------------------

export function matchBashAllowRules(
  command: string,
  toolName: string,
  allowRulesBySource: RulesBySource,
): BashAllowResult {
  const joined = joinLineContinuations(command)
  const subcommands = splitCompoundCommand(joined)

  // Each subcommand must independently match an allow rule
  for (const sub of subcommands) {
    const normalized = normalizeCommand(sub, 'safe-only')
    if (!matchNormalized(normalized, toolName, allowRulesBySource)) {
      return { matched: false }
    }
  }

  // All subcommands matched — find the reporting rule for the first subcommand
  const normalized = normalizeCommand(subcommands[0], 'safe-only')
  for (const rule of iterBashRules(allowRulesBySource, toolName)) {
    if (rule.ruleContent === undefined) {
      return { matched: true, source: rule.source, ruleString: rule.ruleString }
    }
    if (matchesCommandPrefix(normalized, rule.ruleContent)) {
      return { matched: true, source: rule.source, ruleString: rule.ruleString }
    }
  }

  return { matched: true }
}

function matchNormalized(
  normalizedSub: string,
  toolName: string,
  allowRulesBySource: RulesBySource,
): boolean {
  for (const rule of iterBashRules(allowRulesBySource, toolName)) {
    if (rule.ruleContent === undefined) return true
    if (matchesCommandPrefix(normalizedSub, rule.ruleContent)) return true
  }
  return false
}
