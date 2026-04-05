import type { AgentEvent, AgentQueryParams, Terminal } from './types.js'
import { queryLoop } from './query-loop.js'

/**
 * Thin wrapper around queryLoop — cleanup after normal exit only.
 * If the generator throws or is `.return()`-ed, cleanup is skipped.
 */
export async function* query(
  params: AgentQueryParams,
): AsyncGenerator<AgentEvent, Terminal> {
  const terminal = yield* queryLoop(params)
  return terminal
}
