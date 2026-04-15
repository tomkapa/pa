// ---------------------------------------------------------------------------
// Deferred Tool Loading
//
// Classifies tools as "loaded" or "deferred" and provides utilities for
// filtering, announcement, and discovery. Deferred tools are omitted from
// the API `tools` array; the model discovers them via ToolSearchTool.
// ---------------------------------------------------------------------------

import type { Tool } from './types.js'

/**
 * Classify whether a tool should be deferred (schema not sent to API by default).
 *
 * Classification order:
 * 1. `alwaysLoad === true` → loaded (explicit opt-out, even for MCP tools)
 * 2. `isMcp === true` → deferred (MCP tools are workflow-specific and numerous)
 * 3. `name === 'ToolSearch'` → loaded (bootstrapping — model needs it to load others)
 * 4. `shouldDefer === true` → deferred (opt-in for specialist built-in tools)
 * 5. Otherwise → loaded
 */
export function isDeferredTool(tool: Tool<unknown, unknown>): boolean {
  if (tool.alwaysLoad === true) return false
  if (tool.isMcp === true) return true
  if (tool.name === 'ToolSearch') return false
  return tool.shouldDefer === true
}

/**
 * Filter the full tool list to only those that should be sent in the API
 * `tools` array for this call. Includes non-deferred tools plus any
 * deferred tools the model has already discovered via ToolSearch.
 */
export function getToolsForAPICall(
  allTools: Tool<unknown, unknown>[],
  discoveredTools: ReadonlySet<string>,
): Tool<unknown, unknown>[] {
  return allTools.filter(tool => {
    if (!isDeferredTool(tool)) return true
    return discoveredTools.has(tool.name)
  })
}

/**
 * Build the system-reminder announcement listing deferred tool names.
 * Returns `null` when no tools are deferred (nothing to announce).
 *
 * The model sees tool names but NOT their schemas — it must call
 * ToolSearch to load schemas before it can invoke a deferred tool.
 */
export function buildDeferredToolsAnnouncement(
  allTools: Tool<unknown, unknown>[],
  discoveredTools: ReadonlySet<string>,
): string | null {
  const deferred = allTools.filter(
    t => isDeferredTool(t) && !discoveredTools.has(t.name),
  )
  if (deferred.length === 0) return null

  const names = deferred.map(t => t.name).sort().join('\n')
  return [
    '<system-reminder>',
    'The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ToolSearch with query "select:<name>[,<name>...]" to load tool schemas before calling them:',
    names,
    '</system-reminder>',
  ].join('\n')
}
