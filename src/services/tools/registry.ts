import type { Tool } from './types.js'

export function getTools(allTools: Tool<unknown, unknown>[]): Tool<unknown, unknown>[] {
  return allTools.filter(tool => tool.isEnabled())
}

export function findToolByName(
  tools: Tool<unknown, unknown>[],
  name: string,
): Tool<unknown, unknown> | undefined {
  return tools.find(t => t.name === name)
}
