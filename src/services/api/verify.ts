import Anthropic from '@anthropic-ai/sdk'
import { createAnthropicClient } from './client.js'

export async function verifyApiKey(apiKey: string): Promise<boolean> {
  try {
    const client = createAnthropicClient({ apiKey, maxRetries: 2 })
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'test' }],
    })
    return true
  } catch (error: unknown) {
    if (error instanceof Anthropic.AuthenticationError) {
      return false
    }
    throw error
  }
}
