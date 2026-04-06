import type { PermissionResult } from './types.js'

const PROTECTED_DIRS = ['.git', '.claude'] as const

/**
 * Check if a string references a protected path (.git/ or .claude/).
 * Matches both forward and backslash separators.
 */
export function referencesProtectedPath(content: string): string | undefined {
  for (const dir of PROTECTED_DIRS) {
    if (content.includes(dir + '/') || content.includes(dir + '\\') ||
        content.includes('/' + dir) || content.includes('\\' + dir)) {
      return dir
    }
  }
  return undefined
}

/**
 * Shared safety check for tools that operate on paths.
 * Returns a bypass-immune ask result if the path references .git/ or .claude/,
 * or passthrough if safe.
 */
export function checkProtectedPath(path: string, verb: string): PermissionResult {
  const protectedDir = referencesProtectedPath(path)
  if (protectedDir) {
    return {
      behavior: 'ask',
      reason: { type: 'safetyCheck', description: `${verb} targets protected path: ${protectedDir}` },
      message: `This ${verb.toLowerCase()} targets a protected path (${protectedDir}). Allow?`,
      isBypassImmune: true,
    }
  }
  return { behavior: 'passthrough' }
}

/**
 * Filesystem commands that are auto-allowed in acceptEdits mode.
 */
const FILESYSTEM_COMMAND_PREFIXES = [
  'mkdir',
  'touch',
  'rm ',
  'rm\t',
  'rmdir',
  'mv ',
  'mv\t',
  'cp ',
  'cp\t',
  'sed ',
  'sed\t',
] as const

/**
 * Check if a command is a filesystem operation (for acceptEdits mode).
 */
export function isFilesystemCommand(command: string): boolean {
  const trimmed = command.trimStart()
  return FILESYSTEM_COMMAND_PREFIXES.some(prefix => trimmed.startsWith(prefix))
}
