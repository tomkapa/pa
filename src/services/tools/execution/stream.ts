/**
 * Push-pull async queue adapter.
 *
 * Producer side: enqueue(value), done(), error(err)
 * Consumer side: implements AsyncIterator<T> for `for await...of`
 *
 * Used to bridge callback-based tool progress into async generator event flow.
 */
export class Stream<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private waiting: {
    resolve: (result: IteratorResult<T>) => void
    reject: (err: unknown) => void
  } | null = null
  private isDone = false
  private err: unknown = null

  /** Non-blocking push. Ignored after done() or error(). */
  enqueue(value: T): void {
    if (this.isDone) return

    if (this.waiting) {
      const w = this.waiting
      this.waiting = null
      w.resolve({ value, done: false })
    } else {
      this.queue.push(value)
    }
  }

  /** Signal no more values will be produced. */
  done(): void {
    if (this.isDone) return
    this.isDone = true

    if (this.waiting) {
      const w = this.waiting
      this.waiting = null
      w.resolve({ value: undefined as T, done: true })
    }
  }

  /** Signal an error. Any pending or future next() will reject. */
  error(err: unknown): void {
    if (this.isDone) return
    this.err = err
    this.isDone = true

    if (this.waiting) {
      const w = this.waiting
      this.waiting = null
      w.reject(err)
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
    }
  }

  private async next(): Promise<IteratorResult<T>> {
    if (this.queue.length > 0) {
      return { value: this.queue.shift()!, done: false }
    }
    if (this.err != null) {
      throw this.err
    }
    if (this.isDone) {
      return { value: undefined as T, done: true }
    }

    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiting = { resolve, reject }
    })
  }
}
