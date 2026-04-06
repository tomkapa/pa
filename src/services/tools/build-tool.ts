import type { Tool, ToolDef } from './types.js'

export function buildTool<Input, Output>(def: ToolDef<Input, Output>): Tool<Input, Output> {
  return {
    // Fail-closed defaults
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
    isEnabled: () => true,
    checkPermissions: () =>
      Promise.resolve({ behavior: 'passthrough' as const }),
    userFacingName: () => def.name,

    // Definition overrides defaults
    ...def,
  }
}
