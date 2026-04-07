// ---------------------------------------------------------------------------
// Dynamic System Prompt Sections
//
// These sections form the *dynamic zone* of the assembled prompt — they
// change per session (e.g. memory, env, language) or per turn (e.g. MCP
// instructions). Each builder is a pure function returning `string | null`
// — `null` opts the section out so it disappears from the assembled
// prompt entirely.
//
// Builders take their inputs explicitly (rather than reading globals)
// because the section registry composes them with `() => builder(...)`,
// keeping every input visible at the call site.
// ---------------------------------------------------------------------------

import {
  formatMemoryForPrompt,
  loadMemory,
  type LoadMemoryOptions,
} from '../memory/index.js'

/**
 * Minimal shape for an MCP server we accept here. Real `MCPClient` types
 * live in a future task — keep this interface narrow so this module
 * doesn't depend on a server implementation that doesn't exist yet.
 */
export interface MCPServerInfo {
  name: string
  /** Optional server-provided usage instructions to inject into the prompt. */
  instructions?: string
}

/**
 * Loaded skill summary used by the session-guidance section.
 */
export interface SkillSummary {
  name: string
  description?: string
}

/**
 * Build the session-guidance section. Lists tool-specific hints (e.g.
 * "use Agent for broad searches") and any skills that are available in
 * the current working directory. Returns `null` when there is nothing
 * useful to say so the section disappears entirely.
 */
export function getSessionGuidanceSection(
  enabledTools: ReadonlySet<string>,
  skills: ReadonlyArray<SkillSummary>,
): string | null {
  const lines: string[] = []

  if (enabledTools.has('Agent')) {
    lines.push(
      ' - For broad codebase exploration use the Agent tool with a search-oriented subagent. For directed lookups (a specific file/class/function) use Glob or Grep directly.',
    )
  }
  if (enabledTools.has('TodoWrite') || enabledTools.has('TaskCreate')) {
    lines.push(
      ' - Track multi-step work with the task tool. Mark each task done as soon as it is finished — do not batch updates.',
    )
  }
  if (skills.length > 0) {
    lines.push(' - The following skills are available for this session:')
    for (const skill of skills) {
      const desc = skill.description ? ` — ${skill.description}` : ''
      lines.push(`   - /${skill.name}${desc}`)
    }
  }

  if (lines.length === 0) return null
  return ['# Session-specific guidance', ...lines].join('\n')
}

/**
 * Build the memory section by loading every CLAUDE.md / rule file the
 * agent should know about and formatting them into a single labeled
 * block. Conditional rules (with `paths:` frontmatter) are intentionally
 * NOT injected here — they are activated on demand by the tool layer.
 *
 * Returns `null` when no memory files are present so the section
 * disappears from the assembled prompt entirely.
 */
export async function getMemorySection(
  options: LoadMemoryOptions = {},
): Promise<string | null> {
  const memory = await loadMemory(options)
  const formatted = formatMemoryForPrompt(memory.unconditional)
  if (formatted.length === 0) return null
  return `# Memory\n\n${formatted}`
}

export interface EnvironmentInfo {
  modelId: string
  modelName?: string
  os: string
  shell: string
  cwd: string
  knowledgeCutoff?: string
}

/**
 * Build the environment-info section. Critically, **git status is NOT
 * included here** — it lives in the per-session "system context" so it
 * doesn't bust the prompt cache.
 */
export function getEnvironmentInfoSection(env: EnvironmentInfo): string {
  const lines: string[] = ['# Environment', 'You have been invoked in the following environment:']
  lines.push(` - Working directory: ${env.cwd}`)
  if (env.modelName) {
    lines.push(` - Model: ${env.modelName} (id: ${env.modelId})`)
  } else {
    lines.push(` - Model: ${env.modelId}`)
  }
  lines.push(` - OS: ${env.os}`)
  lines.push(` - Shell: ${env.shell}`)
  if (env.knowledgeCutoff) {
    lines.push(` - Knowledge cutoff: ${env.knowledgeCutoff}`)
  }
  return lines.join('\n')
}

/** Compute the env-info struct from the live process. */
export function computeEnvironmentInfo(modelId: string, modelName?: string): EnvironmentInfo {
  return {
    modelId,
    modelName,
    os: `${process.platform} ${process.arch}`,
    shell: process.env['SHELL'] ?? 'unknown',
    cwd: process.cwd(),
  }
}

/**
 * Build the language preference section. Returns `null` when the user
 * hasn't configured a language so English is used by default and no
 * extra prompt content is needed.
 */
export function getLanguageSection(language?: string): string | null {
  if (!language || language.trim().length === 0) return null
  return `# Language\nAlways respond to the user in ${language.trim()}.`
}

/**
 * Build the output-style section from a free-form configuration string.
 * The configuration is interpreted verbatim (no validation, no parsing) —
 * the user is opting into a custom voice/format and we shouldn't second-guess.
 */
export function getOutputStyleSection(config?: string): string | null {
  if (!config || config.trim().length === 0) return null
  return `# Output style\n${config.trim()}`
}

/**
 * Build the MCP-instructions section by concatenating the per-server
 * instructions of every connected MCP client. Each block is labeled by
 * server name so the model can attribute instructions to their source.
 *
 * This is the one section that should be wrapped in `uncachedSection`
 * because MCP servers can connect/disconnect mid-session.
 */
export function getMcpInstructionsSection(
  mcpClients?: ReadonlyArray<MCPServerInfo>,
): string | null {
  if (!mcpClients || mcpClients.length === 0) return null
  const blocks: string[] = []
  for (const client of mcpClients) {
    const instructions = client.instructions?.trim()
    if (!instructions) continue
    blocks.push(`## ${client.name}\n${instructions}`)
  }
  if (blocks.length === 0) return null
  return [
    '# MCP Server Instructions',
    'The following MCP servers have provided instructions for how to use their tools and resources:',
    ...blocks,
  ].join('\n\n')
}
