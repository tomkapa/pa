import { homedir } from 'node:os'
import { resolve, isAbsolute } from 'node:path'

/**
 * Normalize a file path from tool input into a canonical absolute path.
 *
 * - Expands `~` to the user's home directory
 * - Resolves relative paths against cwd
 * - Rejects null bytes (path traversal attack vector)
 */
export function expandPath(filePath: string, cwd: string = process.cwd()): string {
  if (filePath.includes('\0')) {
    throw new Error('File path must not contain null bytes')
  }

  if (filePath === '~' || filePath.startsWith('~/')) {
    return resolve(homedir(), filePath.slice(2))
  }

  if (!isAbsolute(filePath)) {
    return resolve(cwd, filePath)
  }

  return resolve(filePath)
}

/**
 * Returns true for UNC-style paths that could leak NTLM credentials on Windows.
 */
export function isUNCPath(filePath: string): boolean {
  return filePath.startsWith('\\\\') || filePath.startsWith('//')
}
