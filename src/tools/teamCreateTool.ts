import { z, type ZodType } from 'zod'
import type { ToolDef, ToolResultBlockParam } from '../services/tools/types.js'
import {
  allocateUniqueTeamName,
  buildAgentId,
  createTeam,
  setActiveTeamName,
  TEAM_LEADER_NAME,
} from '../services/teams/index.js'
import { logForDebugging } from '../services/observability/debug.js'

export interface TeamCreateInput {
  team_name: string
  description?: string
}

export interface TeamCreateOutput {
  team_name: string
  lead_agent_id: string
}

export function teamCreateToolDef(): ToolDef<TeamCreateInput, TeamCreateOutput> {
  return {
    name: 'TeamCreate',
    shouldDefer: true,
    maxResultSizeChars: 2_000,

    get inputSchema(): ZodType<TeamCreateInput> {
      return z.strictObject({
        team_name: z
          .string()
          .min(1)
          .describe(
            'Human-readable name for the team (will be sanitized and deduplicated).',
          ),
        description: z
          .string()
          .optional()
          .describe("Short description of the team's goal."),
      }) as ZodType<TeamCreateInput>
    },

    isReadOnly: () => false,
    isConcurrencySafe: () => false,

    async prompt() {
      return [
        'Create a new agent team rooted at this session. The calling agent becomes the team leader.',
        '',
        'Use this when you want to delegate work to one or more teammates running as',
        'independent agents. After creating the team, spawn teammates by calling the Agent',
        'tool with both `name` and `team_name` set — each spawn launches a separate',
        'process that reads tasks from its mailbox.',
        '',
        'The team name is sanitized (lowercased, spaces → hyphens, specials stripped).',
        'If the sanitized name already exists on disk, a numeric suffix is appended so',
        'the returned `team_name` may differ from the requested one.',
      ].join('\n')
    },

    async description(input) {
      return `TeamCreate: ${input.team_name}`
    },

    userFacingName(input) {
      return input?.team_name ? `TeamCreate(${input.team_name})` : 'TeamCreate'
    },

    async call(input) {
      const finalName = await allocateUniqueTeamName(input.team_name)
      const leadAgentId = buildAgentId(TEAM_LEADER_NAME, finalName)
      await createTeam({
        teamName: finalName,
        description: input.description ?? '',
        leadAgentId,
      })
      setActiveTeamName(finalName)
      logForDebugging(
        `team_create: name="${finalName}" lead="${leadAgentId}"`,
        { level: 'info' },
      )
      return { data: { team_name: finalName, lead_agent_id: leadAgentId } }
    },

    mapToolResultToToolResultBlockParam(
      output,
      toolUseID,
    ): ToolResultBlockParam {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content:
          `Team "${output.team_name}" created. Leader agent: ${output.lead_agent_id}. ` +
          `Spawn teammates by calling Agent with name + team_name="${output.team_name}".`,
      }
    },
  }
}
