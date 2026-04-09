/**
 * Race a promise against a timeout. Rejects with a TimeoutError if the
 * timeout fires first. An optional `onTimeout` callback runs when the
 * timeout triggers (e.g. to kill a transport).
 */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.()
      reject(new TimeoutError(ms))
    }, ms)
    // Avoid holding the process open if everything else is done.
    timer.unref()

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
