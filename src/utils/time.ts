/**
 * Format a duration in milliseconds as a human-readable elapsed time string.
 * e.g., 5000 → "5s", 125000 → "2m05s"
 */
export function formatElapsed(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}m${remainder.toString().padStart(2, '0')}s`
}
