import { readFile } from 'node:fs/promises'
import type { SlashCommand, SlashCommandContext } from '../../commands/registry.js'
import { normalizeToolList } from '../memory/frontmatter.js'
import { parseFrontmatter, type CommandFrontmatter } from './frontmatter.js'
import { substituteArguments, parseArgNames } from './arguments.js'
import { scanCommandDirectories, type DiscoveredCommand } from './scanner.js'

export interface RegisteredCustomCommand {
  name: string
  description: string
  argumentHint?: string
  allowedTools?: string[]
  model?: string
  argNames: string[]
  source: 'user' | 'project'
  getPrompt: (args: string) => Promise<string>
}

interface LoadDirectoriesOptions {
  userDirs: string[]
  projectDirs: string[]
}

/**
 * In-memory registry of custom slash commands discovered from disk.
 *
 * Frontmatter metadata (description, hints) is read eagerly at load time
 * for autocomplete. The prompt content is re-read from disk on each
 * invocation so edits take effect without restart.
 */
export class CustomCommandRegistry {
  private readonly commands = new Map<string, RegisteredCustomCommand>()

  /**
   * Discover and register commands from user and project directories.
   *
   * User commands shadow project commands when they share the same name.
   * Within each source, later directories take precedence.
   */
  async loadFromDirectories(opts: LoadDirectoriesOptions): Promise<void> {
    this.commands.clear()

    // Scan user and project directories concurrently (they are independent)
    const [projectCommands, userCommands] = await Promise.all([
      scanCommandDirectories(opts.projectDirs, 'project'),
      scanCommandDirectories(opts.userDirs, 'user'),
    ])

    // Register project commands first, then user commands (user overwrites)
    const allDiscovered = [...projectCommands, ...userCommands]

    for (const discovered of allDiscovered) {
      const registered = await this.registerCommand(discovered)
      if (registered) {
        this.commands.set(discovered.name.toLowerCase(), registered)
      }
    }
  }

  /**
   * Read a discovered command file and extract frontmatter metadata.
   * Returns a registered command whose `getPrompt` re-reads the file
   * on each invocation (including re-parsing `arguments` from frontmatter)
   * so edits take effect without restart.
   */
  private async registerCommand(
    discovered: DiscoveredCommand,
  ): Promise<RegisteredCustomCommand | null> {
    let frontmatter: CommandFrontmatter
    try {
      const raw = await readFile(discovered.filePath, 'utf8')
      const parsed = parseFrontmatter(raw)
      frontmatter = parsed.frontmatter
    } catch {
      // File unreadable — skip silently
      return null
    }

    const argNames = parseArgNames(frontmatter.arguments)

    return {
      name: discovered.name,
      description: frontmatter.description ?? '',
      argumentHint: frontmatter['argument-hint'],
      allowedTools: normalizeToolList(frontmatter['allowed-tools']),
      model: frontmatter.model,
      argNames,
      source: discovered.source,
      getPrompt: async (args: string): Promise<string> => {
        const raw = await readFile(discovered.filePath, 'utf8')
        const freshParsed = parseFrontmatter(raw)
        const freshArgNames = parseArgNames(freshParsed.frontmatter.arguments)
        return substituteArguments(freshParsed.content, args, freshArgNames)
      },
    }
  }

  /** Look up a command by exact name (case-insensitive). */
  findCommand(name: string): RegisteredCustomCommand | undefined {
    return this.commands.get(name.toLowerCase())
  }

  /** Filter commands whose name starts with the given prefix (case-insensitive). */
  getCompletions(prefix: string): RegisteredCustomCommand[] {
    const lower = prefix.toLowerCase()
    const results: RegisteredCustomCommand[] = []
    for (const cmd of this.commands.values()) {
      if (!lower || cmd.name.toLowerCase().startsWith(lower)) {
        results.push(cmd)
      }
    }
    return results
  }

  /** Get all registered commands. */
  getAllCommands(): RegisteredCustomCommand[] {
    return [...this.commands.values()]
  }

  /**
   * Convert registered custom commands to `SlashCommand` objects for
   * integration with the autocomplete picker in TextInput.
   *
   * The `execute` handler is a no-op stub — custom commands are dispatched
   * differently from built-in commands (they expand into a user message and
   * trigger an agent turn rather than running client-side).
   */
  toSlashCommands(): SlashCommand[] {
    return this.getAllCommands().map(cmd => ({
      name: cmd.name,
      description: cmd.description || `Custom command (${cmd.source})`,
      execute: async (_ctx: SlashCommandContext): Promise<void> => {
        // No-op: custom commands are handled in the REPL dispatch path,
        // not through SlashCommand.execute.
      },
    }))
  }
}
