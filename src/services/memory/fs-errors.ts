// ---------------------------------------------------------------------------
// Shared filesystem error helpers
//
// The memory loader treats several errno codes as "expected misses" — they
// just mean the file or directory wasn't there, isn't readable, or isn't
// what we expected. We surface them as `null` returns rather than throwing
// so callers don't have to wrap every call site.
// ---------------------------------------------------------------------------

const EXPECTED_FS_ERRORS = new Set<string>([
  'ENOENT',
  'EISDIR',
  'ENOTDIR',
  'EACCES',
  'EPERM',
  'ELOOP',
])

/**
 * Returns true if `code` is a filesystem error we expect to see while
 * scanning for optional config files (file missing, perm denied, etc.).
 */
export function isExpectedFsError(code: string | undefined): boolean {
  if (code === undefined) return false
  return EXPECTED_FS_ERRORS.has(code)
}
