import type { Tool } from '../tools/types.js'
import type { AgentDefinition } from './types.js'

/**
 * Resolve the tool set for a subagent by applying the agent definition's
 * allowlist and blocklist.
 *
 * Order of operations:
 * 1. Start with `availableTools` (the parent's tool pool, already filtered
 *    for child safety — no Agent, no plan mode tools)
 * 2. If `agent.tools` is defined, keep only tools in the allowlist
 * 3. If `agent.disallowedTools` is defined, remove blocklisted tools
 *
 * Tool name matching is case-sensitive (tool names are identifiers, not
 * user-facing strings).
 */
export function resolveAgentTools(
  agent: AgentDefinition,
  availableTools: ReadonlyArray<Tool<unknown, unknown>>,
): Tool<unknown, unknown>[] {
  let result = [...availableTools]

  if (agent.tools !== undefined) {
    const allowSet = new Set(agent.tools)
    result = result.filter(t => allowSet.has(t.name))
  }

  if (agent.disallowedTools !== undefined) {
    const blockSet = new Set(agent.disallowedTools)
    result = result.filter(t => !blockSet.has(t.name))
  }

  return result
}
