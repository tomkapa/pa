import { basename } from 'node:path'

/** Case-insensitive filter: prefix hits first, contains hits second, capped. */
export function filterForToken(
  files: readonly string[],
  token: string,
  limit: number,
): string[] {
  if (!token) return files.slice(0, limit)

  const lower = token.toLowerCase()
  const prefixHits: string[] = []
  const containsHits: string[] = []

  for (const f of files) {
    const fl = f.toLowerCase()
    if (fl.startsWith(lower) || basename(fl).startsWith(lower)) {
      prefixHits.push(f)
    } else if (fl.includes(lower)) {
      containsHits.push(f)
    }
    if (prefixHits.length >= limit) break
  }

  return [...prefixHits, ...containsHits].slice(0, limit)
}
