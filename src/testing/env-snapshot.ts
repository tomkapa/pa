/**
 * Snapshot a set of environment variables and return a `restore()` function
 * that resets each one to its original value (or deletes it if it was unset).
 *
 * Use this in test setup/teardown to isolate env-mutating tests:
 *
 * ```ts
 * let restoreEnv: () => void
 * beforeEach(() => { restoreEnv = snapshotEnv(['NODE_ENV', 'CI']) })
 * afterEach(() => { restoreEnv() })
 * ```
 */
export function snapshotEnv(keys: readonly string[]): () => void {
  const original = new Map<string, string | undefined>()
  for (const k of keys) original.set(k, process.env[k])
  return function restore() {
    for (const [k, v] of original) {
      if (v == null) delete process.env[k]
      else process.env[k] = v
    }
  }
}
