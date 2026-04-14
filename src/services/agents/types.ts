// ---------------------------------------------------------------------------
// Agent Definition Types
//
// Discriminated union: built-in agents have dynamic prompts via functions,
// custom agents (from .pa/agents/*.md) have prompts from file content.
// ---------------------------------------------------------------------------

export interface BaseAgentDefinition {
  /** Identifier used to match `subagent_type` in Agent tool calls. */
  agentType: string
  /** Description shown to the model for agent selection. */
  whenToUse: string
  /** Optional tool allowlist — undefined means all tools. */
  tools?: string[]
  /** Optional tool blocklist — applied after allowlist. */
  disallowedTools?: string[]
  /** Optional model override (e.g. 'haiku', 'sonnet', 'opus'). */
  model?: string
  /** Returns the system prompt for this agent. */
  getSystemPrompt: () => string
}

export interface BuiltInAgentDefinition extends BaseAgentDefinition {
  source: 'built-in'
}

export interface CustomAgentDefinition extends BaseAgentDefinition {
  source: 'project'
  /** Original filename without .md extension. */
  filename: string
}

export type AgentDefinition = BuiltInAgentDefinition | CustomAgentDefinition

// ---------------------------------------------------------------------------
// Agent name validation
// ---------------------------------------------------------------------------

/**
 * Agent names must:
 * - Start and end with alphanumeric characters
 * - Contain only letters, numbers, and hyphens
 * - Be 3–50 characters long
 */
export const AGENT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$/

export const AGENT_NAME_MIN_LENGTH = 3
export const AGENT_NAME_MAX_LENGTH = 50

export function isValidAgentName(name: string): boolean {
  return (
    name.length >= AGENT_NAME_MIN_LENGTH &&
    name.length <= AGENT_NAME_MAX_LENGTH &&
    AGENT_NAME_RE.test(name)
  )
}
