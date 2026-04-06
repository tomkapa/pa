import type { Tool as AnthropicTool } from '@anthropic-ai/sdk/resources/messages/messages'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { Tool } from './types.js'

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

  return enabledTools.map((tool, i) => {
    const jsonSchema = zodToJsonSchema(tool.inputSchema, { target: 'openApi3' })

    return {
      name: tool.name,
      description: descriptions[i],
      input_schema: {
        type: 'object' as const,
        ...('properties' in jsonSchema ? { properties: jsonSchema.properties } : {}),
        ...('required' in jsonSchema && Array.isArray(jsonSchema.required)
          ? { required: jsonSchema.required }
          : {}),
      },
    }
  })
}
