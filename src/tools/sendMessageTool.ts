import { z, type ZodType } from 'zod'
import type { ToolDef, ToolResultBlockParam } from '../services/tools/types.js'
import {
  getAgentName,
  getTeamName,
  readTeamFile,
  sanitizeName,
  TEAM_LEADER_NAME,
  writeToMailbox,
} from '../services/teams/index.js'
import { logForDebugging } from '../services/observability/debug.js'

export interface SendMessageInput {
  to: string
  message: string
  summary?: string
}

export interface SendMessageOutput {
  to: string[]
  timestamp: string
  teamName: string
}

export function sendMessageToolDef(): ToolDef<SendMessageInput, SendMessageOutput> {
  return {
    name: 'SendMessage',
    shouldDefer: true,
    maxResultSizeChars: 2_000,

    get inputSchema(): ZodType<SendMessageInput> {
      return z.strictObject({
        to: z
          .string()
          .min(1)
          .describe(
            `Recipient agent name (e.g. "researcher"), "${TEAM_LEADER_NAME}" to reply to the leader, or "*" to broadcast to every teammate except yourself.`,
          ),
        message: z.string().min(1).describe('Message body.'),
        summary: z
          .string()
          .optional()
          .describe('5–10 word preview used in listings.'),
      }) as ZodType<SendMessageInput>
    },

    isReadOnly: () => false,
    isConcurrencySafe: () => true,

    async prompt() {
      return [
        "Send a message to another agent in your team's mailbox.",
        '',
        'Recipients process messages asynchronously (~1s polling latency). Each message',
        `is injected as a user prompt on the recipient's next turn. Use \`to: "*"\` to`,
        `broadcast to all teammates except yourself; the leader is reachable as`,
        `"${TEAM_LEADER_NAME}".`,
      ].join('\n')
    },

    async description(input) {
      return `SendMessage → ${input.to}: ${input.message.slice(0, 60)}`
    },

    userFacingName(input) {
      return input?.to ? `SendMessage(→${input.to})` : 'SendMessage'
    },

    async call(input) {
      const senderName = getAgentName() ?? TEAM_LEADER_NAME
      const rawTeamName = getTeamName()
      if (!rawTeamName || rawTeamName.trim().length === 0) {
        throw new Error(
          'SendMessage requires an active team (run TeamCreate or spawn as a teammate first).',
        )
      }
      const teamName = sanitizeName(rawTeamName)
      const config = await readTeamFile(teamName)

      const recipients: string[] = []
      if (input.to === '*') {
        for (const member of config.members) {
          if (member.name !== senderName) recipients.push(member.name)
        }
        if (senderName !== TEAM_LEADER_NAME) recipients.push(TEAM_LEADER_NAME)
      } else {
        const target = sanitizeName(input.to)
        if (target === senderName) {
          throw new Error('Cannot SendMessage to yourself.')
        }
        const isLeader = target === TEAM_LEADER_NAME
        const isMember = config.members.some(m => m.name === target)
        if (!isLeader && !isMember) {
          throw new Error(
            `Recipient '${target}' not found in team '${teamName}'. ` +
            `Known members: ${config.members.map(m => m.name).join(', ') || '(none)'}.`,
          )
        }
        recipients.push(target)
      }

      const timestamp = new Date().toISOString()
      const message = {
        from: senderName,
        text: input.message,
        timestamp,
        read: false,
        summary: input.summary,
      }

      // Deliver in parallel — each inbox has its own lockfile, so no
      // inter-recipient contention.
      await Promise.all(
        recipients.map(recipient => writeToMailbox(teamName, recipient, message)),
      )

      logForDebugging(
        `send_message: team="${teamName}" from="${senderName}" to="${recipients.join(',')}"`,
        { level: 'info' },
      )

      return { data: { to: recipients, timestamp, teamName } }
    },

    mapToolResultToToolResultBlockParam(
      output,
      toolUseID,
    ): ToolResultBlockParam {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content:
          output.to.length === 0
            ? `No recipients in team "${output.teamName}".`
            : `Delivered to ${output.to.join(', ')} at ${output.timestamp}.`,
      }
    },
  }
}
