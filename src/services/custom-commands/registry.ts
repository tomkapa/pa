import { readFile } from 'node:fs/promises'
import type { SlashCommand, SlashCommandContext } from '../../commands/registry.js'
import { normalizeToolList } from '../memory/frontmatter.js'
import { parseFrontmatter, type CommandFrontmatter, type EffortValue } from './frontmatter.js'
import { substituteArguments, parseArgNames } from './arguments.js'
import { scanCommandDirectories, type DiscoveredCommand } from './scanner.js'
import { loadSkillsFromDirectory } from '../skills/loader.js'

export interface RegisteredCustomCommand {
  name: string
  description: string
  argumentHint?: string
  allowedTools?: string[]
  model?: string
  argNames: string[]
  source: 'user' | 'project'
  getPrompt: (args: string) => Promise<string>
  // Skill-specific fields (populated when loadedFrom === 'skills')
  loadedFrom: 'commands' | 'skills'
  whenToUse?: string
  userInvocable: boolean
  disableModelInvocation: boolean
  effort?: EffortValue
  version?: string
  skillRoot?: string
  hasUserSpecifiedDescription: boolean
  contentLength: number
}

interface LoadDirectoriesOptions {
  userDirs: string[]
  projectDirs: string[]
  /** User skill directory: `~/.pa/skills/` */
  userSkillDir?: string
  /** Project skill directory: `.pa/skills/` */
  projectSkillDir?: string
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
   * Discover and register commands + skills from user and project directories.
   *
   * Loading order (first-found wins for same name):
   *   1. User skills      (user skills dir)
   *   2. Project skills   (project skills dir)
   *   3. User commands    (user commands dir)
   *   4. Project commands (project commands dir)
   *
   * Skills take priority over commands. Within each category, user
   * takes priority over project.
   */
  async loadFromDirectories(opts: LoadDirectoriesOptions): Promise<void> {
    this.commands.clear()

    // Load all sources concurrently
    const [userSkills, projectSkills, projectCommands, userCommands] =
      await Promise.all([
        opts.userSkillDir
          ? loadSkillsFromDirectory(opts.userSkillDir, 'user')
          : Promise.resolve([]),
        opts.projectSkillDir
          ? loadSkillsFromDirectory(opts.projectSkillDir, 'project')
          : Promise.resolve([]),
        scanCommandDirectories(opts.projectDirs, 'project'),
        scanCommandDirectories(opts.userDirs, 'user'),
      ])

    // Skills first (higher priority), then commands.
    // Within each group, user sources shadow project sources.
    // We register in reverse-priority order so later entries overwrite.
    const allDiscoveredCommands = [...projectCommands, ...userCommands]

    for (const discovered of allDiscoveredCommands) {
      const registered = await this.registerCommand(discovered)
      if (registered) {
        this.commands.set(discovered.name.toLowerCase(), registered)
      }
    }

    // Register skills — they overwrite commands with the same name.
    // Project skills first, then user skills (user wins).
    for (const skill of [...projectSkills, ...userSkills]) {
      this.commands.set(skill.name.toLowerCase(), skill)
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
      // Default skill fields for commands loaded from .pa/commands/
      loadedFrom: 'commands' as const,
      userInvocable: true,
      disableModelInvocation: false,
      hasUserSpecifiedDescription: !!frontmatter.description,
      contentLength: 0, // Not tracked for legacy commands
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
   * Skills with `userInvocable: false` are excluded — they can only
   * be invoked by the model via SkillTool.
   *
   * The `execute` handler is a no-op stub — custom commands are dispatched
   * differently from built-in commands (they expand into a user message and
   * trigger an agent turn rather than running client-side).
   */
  toSlashCommands(): SlashCommand[] {
    return this.getAllCommands()
      .filter(cmd => cmd.userInvocable)
      .map(cmd => ({
        name: cmd.name,
        description: cmd.description || `Custom command (${cmd.source})`,
        execute: async (_ctx: SlashCommandContext): Promise<void> => {
          // No-op: custom commands are handled in the REPL dispatch path,
          // not through SlashCommand.execute.
        },
      }))
  }

  /**
   * Get commands that the model can invoke via SkillTool.
   *
   * Filters to prompt-type commands that are not disabled for model
   * invocation. Both skills and commands are eligible.
   */
  getModelInvocableCommands(): RegisteredCustomCommand[] {
    return this.getAllCommands().filter(cmd => !cmd.disableModelInvocation)
  }
}
