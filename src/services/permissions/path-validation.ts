// ---------------------------------------------------------------------------
// Path Validation — filesystem safety checks for the read-only permission filter
// ---------------------------------------------------------------------------

import { isUNCPath, expandPath } from '../../utils/expandPath.js'

// ---------------------------------------------------------------------------
// Path extraction
// ---------------------------------------------------------------------------

/**
 * Extract filesystem paths from a tool's input.
 * Returns raw path strings (not yet resolved/expanded), or empty array
 * if no recognizable path fields exist.
 */
export function extractToolPaths(input: unknown): string[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return []
  const rec = input as Record<string, unknown>
  const paths: string[] = []
  if (typeof rec.file_path === 'string') paths.push(rec.file_path)
  if (typeof rec.path === 'string') paths.push(rec.path)
  return paths
}

// ---------------------------------------------------------------------------
// Dangerous path detection
// ---------------------------------------------------------------------------

/** Tilde expansion variants that create a TOCTOU gap between validation and shell resolution. */
const DANGEROUS_TILDE_RE = /^~[+\-]|^~[a-zA-Z]/

const SHELL_EXPANSION_RE = /[$%`]/

/**
 * Returns a human-readable reason if the path is dangerous, or null if safe.
 */
export function getDangerousPathReason(filePath: string): string | null {
  if (isUNCPath(filePath)) {
    return 'UNC paths may leak credentials'
  }
  if (DANGEROUS_TILDE_RE.test(filePath)) {
    return 'Tilde expansion variant may resolve to unexpected location'
  }
  if (SHELL_EXPANSION_RE.test(filePath)) {
    return 'Path contains shell expansion syntax'
  }
  return null
}

// ---------------------------------------------------------------------------
// Sensitive path detection
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS = [
  '.env',
  '.ssh/',
  '.ssh\\',
  'credentials',
  'private.key',
  '.netrc',
  '.npmrc',
  '.pgpass',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
] as const

/** Precomputed lowercase patterns — avoids repeated toLowerCase() per call. */
const SENSITIVE_PATTERNS_LOWER = SENSITIVE_PATTERNS.map(p => p.toLowerCase())

/**
 * Returns true if the path matches a sensitive pattern (case-insensitive).
 */
export function isSensitivePath(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return SENSITIVE_PATTERNS_LOWER.some(p => lower.includes(p))
}

// ---------------------------------------------------------------------------
// CWD boundary check
// ---------------------------------------------------------------------------

/**
 * Check if a resolved absolute path is within (or equal to) a base directory.
 * Uses string prefix matching on resolved paths to avoid symlink-based escapes.
 */
export function isWithinDirectory(resolvedPath: string, baseDir: string): boolean {
  const normalizedBase = baseDir.endsWith('/') ? baseDir : baseDir + '/'
  const normalizedPath = resolvedPath.endsWith('/') ? resolvedPath : resolvedPath + '/'
  return normalizedPath.startsWith(normalizedBase)
}

/**
 * Validate a single path for the read-only permission filter.
 *
 * Returns an ask-reason string if the path is dangerous or sensitive,
 * or null if the path is safe and within the given CWD.
 * Returns 'outside-cwd' if the path is safe but outside the working directory.
 */
export function checkReadOnlyPath(
  rawPath: string,
  cwd: string,
): { type: 'dangerous'; reason: string } | { type: 'sensitive' } | { type: 'outside-cwd' } | null {
  const dangerReason = getDangerousPathReason(rawPath)
  if (dangerReason) return { type: 'dangerous', reason: dangerReason }

  if (isSensitivePath(rawPath)) return { type: 'sensitive' }

  const resolved = expandPath(rawPath, cwd)
  if (!isWithinDirectory(resolved, cwd)) return { type: 'outside-cwd' }

  return null
}
