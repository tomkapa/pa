import { z, type ZodType } from 'zod'
import type {
  ToolDef,
  ToolResultBlockParam,
  ToolUseContext,
  ValidationResult,
} from '../services/tools/types.js'
import type { CustomCommandRegistry } from '../services/custom-commands/registry.js'
import { addInvokedSkill } from '../services/skills/invocation-tracking.js'
import { logForDebugging } from '../services/observability/debug.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillToolInput {
  skill: string
  args?: string
}

export interface SkillToolOutput {
  success: boolean
  commandName: string
  status: 'inline'
  allowedTools?: string[]
  model?: string
  /** The expanded skill content returned to the model. */
  content: string
}

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const inputSchema = z.strictObject({
  skill: z.string().describe('The skill name. E.g., "commit", "review-pr", or "pdf"'),
  args: z
    .string()
    .optional()
    .describe('Optional arguments for the skill'),
})

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export interface SkillToolDeps {
  registry: CustomCommandRegistry
}

export function skillToolDef(
  deps: SkillToolDeps,
): ToolDef<SkillToolInput, SkillToolOutput> {
  return {
    name: 'Skill',
    shouldDefer: false,
    maxResultSizeChars: 100_000,

    get inputSchema(): ZodType<SkillToolInput> {
      return inputSchema as ZodType<SkillToolInput>
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,

    async validateInput(
      input: SkillToolInput,
      _context: ToolUseContext,
    ): Promise<ValidationResult> {
      const commandName = normalizeSkillName(input.skill)
      const command = deps.registry.findCommand(commandName)

      if (!command) {
        return { result: false, message: `Unknown skill: ${commandName}` }
      }
      if (command.disableModelInvocation) {
        return {
          result: false,
          message: `${commandName} cannot be invoked by model`,
        }
      }
      return { result: true }
    },

    async prompt() {
      return [
        'Execute a skill within the main conversation',
        '',
        'When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.',
        '',
        'When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.',
        '',
        'How to invoke:',
        '- Use this tool with the skill name and optional arguments',
        '- Examples:',
        '  - `skill: "pdf"` - invoke the pdf skill',
        '  - `skill: "commit", args: "-m \'Fix bug\'"` - invoke with arguments',
        '  - `skill: "review-pr", args: "123"` - invoke with arguments',
        '  - `skill: "ms-office-suite:pdf"` - invoke using fully qualified name',
        '',
        'Important:',
        '- Available skills are listed in system-reminder messages in the conversation',
        '- When a skill matches the user\'s request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task',
        '- NEVER mention a skill without actually calling this tool',
        '- Do not invoke a skill that is already running',
        '- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)',
        '- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again',
      ].join('\n')
    },

    async description() {
      return 'Execute a skill'
    },

    userFacingName(input: Partial<SkillToolInput>) {
      return input.skill ? `Skill(${input.skill})` : 'Skill'
    },

    async call(input: SkillToolInput, _context: ToolUseContext) {
      const commandName = normalizeSkillName(input.skill)
      const command = deps.registry.findCommand(commandName)

      if (!command) {
        logForDebugging(`skill_invoke: unknown skill="${commandName}"`, { level: 'warn' })
        return {
          data: {
            success: false,
            commandName,
            status: 'inline' as const,
            content: `Unknown skill: ${commandName}`,
          },
        }
      }

      addInvokedSkill(commandName)

      const content = await command.getPrompt(input.args ?? '')

      logForDebugging(
        `skill_invoke: name="${commandName}" loadedFrom=${command.loadedFrom} contentLen=${content.length}`,
        { level: 'info' },
      )

      return {
        data: {
          success: true,
          commandName,
          status: 'inline' as const,
          allowedTools: command.allowedTools,
          model: command.model,
          content,
        },
      }
    },

    mapToolResultToToolResultBlockParam(
      output: SkillToolOutput,
      toolUseID: string,
    ): ToolResultBlockParam {
      if (!output.success) {
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUseID,
          content: output.content,
          is_error: true,
        }
      }
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: output.content,
      }
    },
  }
}

function normalizeSkillName(skill: string): string {
  const trimmed = skill.trim()
  return trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
}
