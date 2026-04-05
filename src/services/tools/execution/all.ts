/**
 * Run N async generators concurrently (up to a cap) and yield values
 * as they arrive from any generator.
 *
 * Each generator has exactly one pending next() at a time.
 * When a generator finishes, the next waiting generator starts.
 */
export async function* all<A>(
  generators: AsyncGenerator<A>[],
  concurrencyCap = Infinity,
): AsyncGenerator<A> {
  if (generators.length === 0) return

  type Settled = { idx: number; result: IteratorResult<A> }

  const active = new Map<number, AsyncGenerator<A>>()
  const promises = new Map<number, Promise<Settled>>()
  let nextGenIdx = 0

  function advance(idx: number, gen: AsyncGenerator<A>): void {
    promises.set(idx, gen.next().then(result => ({ idx, result })))
  }

  function startGenerators(): void {
    while (active.size < concurrencyCap && nextGenIdx < generators.length) {
      const gen = generators[nextGenIdx]!
      active.set(nextGenIdx, gen)
      advance(nextGenIdx, gen)
      nextGenIdx++
    }
  }

  startGenerators()

  while (active.size > 0) {
    const { idx, result } = await Promise.race(promises.values())

    if (result.done) {
      active.delete(idx)
      promises.delete(idx)
      startGenerators()
    } else {
      yield result.value
      const gen = active.get(idx)
      if (gen) {
        advance(idx, gen)
      }
    }
  }
}
