import type { Tool as AnthropicTool } from '@anthropic-ai/sdk/resources/messages/messages'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Tool } from './types.js'

/**
 * Extract the JSON Schema for a tool's input. MCP tools provide raw JSON
 * Schema directly; Zod-based tools are converted via `zodToJsonSchema`.
 *
 * Shared by `toApiTools` (API call preparation) and `toolSearchTool`
 * (ToolSearch result formatting) so the schema extraction logic lives
 * in one place.
 */
export function toolInputToJsonSchema(
  tool: Tool<unknown, unknown>,
): Record<string, unknown> {
  if (tool.inputJSONSchema) {
    const raw = tool.inputJSONSchema
    return {
      type: 'object',
      ...('properties' in raw ? { properties: raw.properties } : {}),
      ...('required' in raw && Array.isArray(raw.required)
        ? { required: raw.required as string[] }
        : {}),
    }
  }

  const jsonSchema = zodToJsonSchema(tool.inputSchema, { target: 'openApi3' })
  return {
    type: 'object',
    ...('properties' in jsonSchema ? { properties: jsonSchema.properties } : {}),
    ...('required' in jsonSchema && Array.isArray(jsonSchema.required)
      ? { required: jsonSchema.required }
      : {}),
  }
}

/**
 * Convert internal Tool definitions to the Anthropic API's tool format.
 * Called once per query session (cached by the caller in deps.ts).
 */
export async function toApiTools(
  tools: Tool<unknown, unknown>[],
): Promise<AnthropicTool[]> {
  const enabledTools = tools.filter(t => t.isEnabled())

  const descriptions = await Promise.all(
    enabledTools.map(t => t.prompt()),
  )

  return enabledTools.map((tool, i) => ({
    name: tool.name,
    description: descriptions[i],
    input_schema: toolInputToJsonSchema(tool) as AnthropicTool['input_schema'],
  }))
}
