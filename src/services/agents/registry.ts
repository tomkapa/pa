import type { AgentDefinition, BuiltInAgentDefinition, CustomAgentDefinition } from './types.js'
import { loadCustomAgentDefinitions } from './loader.js'

/**
 * Registry of agent definitions, merging built-in and custom agents.
 *
 * Custom agents override built-in agents with the same `agentType` (case-
 * insensitive match). This lets users replace or customize built-in agents
 * by creating a `.pa/agents/<name>.md` file.
 *
 * The registry is loaded once and cached for the session — agent files
 * don't change mid-session.
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>()

  /** Register a single agent definition. Later registrations override earlier ones. */
  register(agent: AgentDefinition): void {
    this.agents.set(agent.agentType.toLowerCase(), agent)
  }

  /** Register multiple built-in agent definitions. */
  registerBuiltIns(agents: BuiltInAgentDefinition[]): void {
    for (const agent of agents) {
      this.register(agent)
    }
  }

  /** Register multiple custom agent definitions (override built-ins). */
  registerCustom(agents: CustomAgentDefinition[]): void {
    for (const agent of agents) {
      this.register(agent)
    }
  }

  /** Look up an agent by type (case-insensitive). */
  findAgent(agentType: string): AgentDefinition | undefined {
    return this.agents.get(agentType.toLowerCase())
  }

  /** Get all registered agents. */
  getAllAgents(): AgentDefinition[] {
    return [...this.agents.values()]
  }

  /** Number of registered agents. */
  get size(): number {
    return this.agents.size
  }
}

/**
 * Load custom agents from a `.pa/agents/` directory and merge them into
 * a new registry alongside the provided built-in agents.
 *
 * Built-ins are registered first, then custom agents override by name.
 */
export async function createAgentRegistry(
  builtIns: BuiltInAgentDefinition[],
  agentsDir: string,
): Promise<AgentRegistry> {
  const registry = new AgentRegistry()
  registry.registerBuiltIns(builtIns)

  const custom = await loadCustomAgentDefinitions(agentsDir)
  registry.registerCustom(custom)

  return registry
}
