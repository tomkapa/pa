// ---------------------------------------------------------------------------
// Managed Settings — Organization-Enforced Policy Layer
//
// Managed settings provide the highest-priority settings source that
// individual users cannot override. They're loaded from a platform-specific
// file path that requires admin/root access to modify.
//
// Platform paths:
//   macOS:  /Library/Application Support/ClaudeCode/managed-settings.json
//   Linux:  /etc/claude-code/managed-settings.json
//   Windows: C:\ProgramData\ClaudeCode\managed-settings.json
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { isNodeError } from '../../utils/error.js'

// ---------------------------------------------------------------------------
// Settings schema
// ---------------------------------------------------------------------------

/**
 * Schema for settings.json files — shared across all settings sources.
 * Deliberately loose: unknown keys are allowed for forward compatibility.
 */
export const SettingsJsonSchema = z.object({
  permissions: z.object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
    ask: z.array(z.string()).optional(),
  }).optional(),
  allowManagedPermissionRulesOnly: z.boolean().optional(),
}).passthrough()

export type SettingsJson = z.infer<typeof SettingsJsonSchema>

// ---------------------------------------------------------------------------
// Platform-specific path resolution
// ---------------------------------------------------------------------------

/**
 * Get the root directory where admin-managed Claude Code config lives.
 *
 *   macOS:  /Library/Application Support/ClaudeCode
 *   Linux:  /etc/claude-code
 *   Windows: C:\ProgramData\ClaudeCode
 *
 * Both `managed-settings.json` and the managed CLAUDE.md / rules tree
 * live under this root, so several modules need to agree on it.
 */
export function getManagedConfigRoot(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case 'darwin':
      return '/Library/Application Support/ClaudeCode'
    case 'win32':
      return 'C:\\ProgramData\\ClaudeCode'
    default:
      // Linux and other POSIX
      return '/etc/claude-code'
  }
}

/**
 * Get the managed settings file path for the current platform.
 */
export function getManagedSettingsPath(platform: NodeJS.Platform = process.platform): string {
  // Use the platform-specific join so Windows paths stay backslash-separated
  // even when this code runs on POSIX (e.g., a CI matrix entry).
  const joiner = platform === 'win32' ? path.win32.join : path.posix.join
  return joiner(getManagedConfigRoot(platform), 'managed-settings.json')
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export interface ManagedSettingsResult {
  loaded: boolean
  settings?: SettingsJson
  error?: string
  path: string
}

/**
 * Load managed settings from the platform-specific path.
 *
 * Returns `{ loaded: false }` if the file doesn't exist or can't be read
 * (not an error — managed settings are optional).
 *
 * Returns `{ loaded: false, error }` if the file exists but is invalid JSON
 * or fails schema validation.
 */
export function loadManagedSettings(
  platform?: NodeJS.Platform,
): ManagedSettingsResult {
  const filePath = getManagedSettingsPath(platform)

  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch (err) {
    // File doesn't exist or can't be read — this is normal
    if (isNodeError(err) && (err.code === 'ENOENT' || err.code === 'EACCES')) {
      return { loaded: false, path: filePath }
    }
    return {
      loaded: false,
      error: `Failed to read managed settings: ${err instanceof Error ? err.message : String(err)}`,
      path: filePath,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      loaded: false,
      error: `Managed settings file contains invalid JSON: ${filePath}`,
      path: filePath,
    }
  }

  const result = SettingsJsonSchema.safeParse(parsed)
  if (!result.success) {
    return {
      loaded: false,
      error: `Managed settings validation failed: ${result.error.message}`,
      path: filePath,
    }
  }

  return { loaded: true, settings: result.data, path: filePath }
}

/**
 * Extract permission rules from a SettingsJson object.
 */
export function extractPermissionRules(
  settings: SettingsJson,
): { allow: string[]; deny: string[]; ask: string[] } {
  return {
    allow: settings.permissions?.allow ?? [],
    deny: settings.permissions?.deny ?? [],
    ask: settings.permissions?.ask ?? [],
  }
}

