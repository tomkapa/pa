import { z, type ZodType } from 'zod'
import type { ToolDef, ToolResultBlockParam } from '../services/tools/types.js'
import { semanticBoolean } from '../utils/schema.js'
import {
  deleteTeam,
  getTeamName,
  readTeamFile,
  sanitizeName,
  setActiveTeamName,
} from '../services/teams/index.js'
import { logForDebugging } from '../services/observability/debug.js'

export interface TeamDeleteInput {
  team_name: string
  force?: boolean
}

export interface TeamDeleteOutput {
  team_name: string
  deleted: boolean
  activeMembers: string[]
}

export function teamDeleteToolDef(): ToolDef<TeamDeleteInput, TeamDeleteOutput> {
  return {
    name: 'TeamDelete',
    shouldDefer: true,
    maxResultSizeChars: 2_000,

    get inputSchema(): ZodType<TeamDeleteInput> {
      return z.strictObject({
        team_name: z.string().min(1).describe('Name of the team to delete.'),
        force: semanticBoolean(z.boolean())
          .optional()
          .describe(
            'Delete even if there are active teammates. Defaults to false.',
          ),
      }) as ZodType<TeamDeleteInput>
    },

    isReadOnly: () => false,
    isConcurrencySafe: () => false,

    async prompt() {
      return [
        'Delete a team and all its mailboxes.',
        '',
        'By default, refuses to delete a team that still has active teammates so you',
        'don\'t accidentally orphan running processes. Pass `force: true` to delete',
        'anyway — be aware that any teammate still alive will continue running, but',
        'its mailbox and team config will no longer exist.',
      ].join('\n')
    },

    async description(input) {
      return `TeamDelete: ${input.team_name}`
    },

    userFacingName(input) {
      return input?.team_name ? `TeamDelete(${input.team_name})` : 'TeamDelete'
    },

    async call(input) {
      const teamName = sanitizeName(input.team_name)
      let activeMembers: string[] = []
      try {
        const config = await readTeamFile(teamName)
        activeMembers = config.members.filter(m => m.isActive).map(m => m.name)
      } catch {
        // Team already absent — treat delete as idempotent.
        return {
          data: { team_name: teamName, deleted: true, activeMembers: [] },
        }
      }

      if (activeMembers.length > 0 && !input.force) {
        logForDebugging(
          `team_delete_blocked: name="${teamName}" active=${activeMembers.length}`,
          { level: 'warn' },
        )
        return {
          data: { team_name: teamName, deleted: false, activeMembers },
        }
      }

      await deleteTeam(teamName)
      if (getTeamName() === teamName) setActiveTeamName(null)
      logForDebugging(
        `team_delete: name="${teamName}" forced=${input.force === true}`,
        { level: 'info' },
      )
      return { data: { team_name: teamName, deleted: true, activeMembers } }
    },

    mapToolResultToToolResultBlockParam(
      output,
      toolUseID,
    ): ToolResultBlockParam {
      if (!output.deleted) {
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUseID,
          is_error: true,
          content:
            `Team "${output.team_name}" still has ${output.activeMembers.length} ` +
            `active teammate(s): ${output.activeMembers.join(', ')}. ` +
            `Wait for them to finish or pass force: true.`,
        }
      }
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: `Team "${output.team_name}" deleted.`,
      }
    },
  }
}
