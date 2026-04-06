import type { ToolUseContext } from '../services/tools/types.js'

export function makeContext(overrides?: Partial<ToolUseContext>): ToolUseContext {
  return {
    abortController: new AbortController(),
    messages: [],
    options: { tools: [], debug: false, verbose: false },
    ...overrides,
  }
}
