// ---------------------------------------------------------------------------
// Simple throttle with leading + trailing support
// ---------------------------------------------------------------------------

export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  intervalMs: number,
): T & { cancel(): void } {
  let lastCallTime = 0
  let trailingTimer: ReturnType<typeof setTimeout> | null = null

  const throttled = (...args: unknown[]) => {
    const now = Date.now()
    const elapsed = now - lastCallTime

    if (elapsed >= intervalMs) {
      // Leading: execute immediately
      lastCallTime = now
      if (trailingTimer !== null) {
        clearTimeout(trailingTimer)
        trailingTimer = null
      }
      fn(...args)
    } else {
      // Trailing: schedule execution after remaining time
      if (trailingTimer !== null) {
        clearTimeout(trailingTimer)
      }
      trailingTimer = setTimeout(() => {
        lastCallTime = Date.now()
        trailingTimer = null
        fn(...args)
      }, intervalMs - elapsed)
    }
  }

  throttled.cancel = () => {
    if (trailingTimer !== null) {
      clearTimeout(trailingTimer)
      trailingTimer = null
    }
  }

  return throttled as T & { cancel(): void }
}
