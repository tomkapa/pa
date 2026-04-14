import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { logForDebugging } from '../observability/debug.js'
import { parseAgentFrontmatter, normalizeToolList } from './frontmatter.js'
import { isValidAgentName, type CustomAgentDefinition } from './types.js'

interface AgentFileEntry {
  filePath: string
  filename: string
}

function parseAgentFile(
  filePath: string,
  filename: string,
  raw: string,
): CustomAgentDefinition | undefined {
  const { frontmatter, content } = parseAgentFrontmatter(raw)

  if (typeof frontmatter.name !== 'string' || frontmatter.name.trim().length === 0) {
    return undefined
  }
  if (typeof frontmatter.description !== 'string' || frontmatter.description.trim().length === 0) {
    return undefined
  }

  const agentName = frontmatter.name.trim()

  if (!isValidAgentName(agentName)) {
    logForDebugging(
      `agent_load_skip: invalid agent name "${agentName}" in "${filePath}" — ` +
      'names must be 3–50 chars, alphanumeric with hyphens, no leading/trailing hyphens',
      { level: 'warn' },
    )
    return undefined
  }

  const tools = normalizeToolList(frontmatter.tools)
  const disallowedTools = normalizeToolList(frontmatter.disallowedTools)
  const model = typeof frontmatter.model === 'string' ? frontmatter.model.trim() : undefined
  const promptBody = content

  return {
    agentType: agentName,
    whenToUse: frontmatter.description.trim(),
    tools,
    disallowedTools,
    model: model || undefined,
    getSystemPrompt: () => promptBody,
    source: 'project',
    filename,
  }
}

/**
 * Scan a directory for `.md` files and construct `CustomAgentDefinition`
 * objects from those with valid agent frontmatter.
 *
 * Files without the required `name` and `description` frontmatter fields are
 * silently skipped (they may be documentation co-located with agent files).
 * Files with invalid agent names are logged as warnings and skipped.
 *
 * Non-recursive: only top-level `.md` files in the directory are loaded.
 * Files are read concurrently for faster startup.
 */
export async function loadCustomAgentDefinitions(
  agentsDir: string,
): Promise<CustomAgentDefinition[]> {
  let entries: import('node:fs').Dirent[]
  try {
    const raw = await readdir(agentsDir, { withFileTypes: true })
    entries = raw as unknown as import('node:fs').Dirent[]
  } catch {
    return []
  }

  const mdFiles: AgentFileEntry[] = []
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      mdFiles.push({
        filePath: path.join(agentsDir, entry.name),
        filename: entry.name.slice(0, -3),
      })
    }
  }

  if (mdFiles.length === 0) return []

  const results = await Promise.all(
    mdFiles.map(async ({ filePath, filename }) => {
      let raw: string
      try {
        raw = await readFile(filePath, 'utf8')
      } catch {
        logForDebugging(`agent_load_skip: unreadable file "${filePath}"`, { level: 'warn' })
        return undefined
      }
      return parseAgentFile(filePath, filename, raw)
    }),
  )

  return results.filter((d): d is CustomAgentDefinition => d !== undefined)
}
