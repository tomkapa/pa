// ---------------------------------------------------------------------------
// Slash Command Registry
//
// Single source of truth for every slash command the REPL supports.
// Each entry carries a name, description (shown in the autocomplete picker),
// and an `execute` handler. repl.tsx dispatches to these handlers — no
// inline command logic lives in the REPL itself.
//
// To add a new command: define it here and it works everywhere (picker +
// dispatch).
// ---------------------------------------------------------------------------

import type { Message } from '../types/message.js'
import type { SummarizeFn } from '../services/agent/auto-compact.js'
import {
  compactConversation,
  buildPostCompactMessages,
  getTokenCountFromLastResponse,
} from '../services/agent/auto-compact.js'
import { getMessagesAfterCompactBoundary } from '../services/messages/predicates.js'
import {
  resetSectionCache,
  resetUserContextCache,
  resetSystemContextCache,
} from '../services/system-prompt/index.js'
import { clearPlanSlug } from '../services/plans/index.js'
import { getSessionId } from '../services/observability/state.js'
import { getAllConnections } from '../services/mcp/index.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Dependencies injected by the REPL when dispatching a slash command. */
export interface SlashCommandContext {
  /** The raw arguments after the command name (trimmed). */
  readonly args: string
  /** Signal for abort/cancellation. */
  readonly abortSignal: AbortSignal
  /** Current conversation messages (snapshot). */
  readonly messages: () => readonly Message[]
  /** Add a system-level message to the conversation UI. */
  readonly addSystemMessage: (
    subtype: string,
    content: string,
    level: 'info' | 'warning' | 'error',
  ) => void
  /** Persist a single message to the session file. */
  readonly persistMessage: (msg: Message) => void
  /** Replace the entire message list via updater. */
  readonly setMessages: (updater: (prev: Message[]) => Message[]) => void
  /** Optional summarizer — required by `/compact`. */
  readonly summarize?: SummarizeFn
}

export interface SlashCommand {
  /** Command name without the leading `/`. */
  readonly name: string
  /** One-line description shown in the autocomplete picker. */
  readonly description: string
  /** Handler invoked when the command is submitted. */
  readonly execute: (ctx: SlashCommandContext) => Promise<void>
}

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

const compactCommand: SlashCommand = {
  name: 'compact',
  description: 'Compact conversation history',
  execute: async (ctx) => {
    if (!ctx.summarize) {
      throw new Error('/compact: no summarizer configured')
    }
    const visible = getMessagesAfterCompactBoundary(ctx.messages() as Message[])
    if (visible.length === 0) {
      ctx.addSystemMessage('compact_skipped', 'Nothing to compact yet.', 'info')
      return
    }
    const result = await compactConversation({
      messages: visible,
      summarize: ctx.summarize,
      trigger: 'manual',
      customInstructions: ctx.args.length > 0 ? ctx.args : undefined,
      abortSignal: ctx.abortSignal,
      preCompactTokenCount: getTokenCountFromLastResponse(visible),
    })
    const postCompact = buildPostCompactMessages(result)
    for (const m of postCompact) ctx.persistMessage(m)
    ctx.setMessages(prev => [...prev, ...postCompact])
  },
}

const clearCommand: SlashCommand = {
  name: 'clear',
  description: 'Clear conversation and reset caches',
  execute: async (ctx) => {
    ctx.setMessages(() => [])
    resetSectionCache()
    resetUserContextCache()
    resetSystemContextCache()
    clearPlanSlug(getSessionId())
    ctx.addSystemMessage('conversation_cleared', 'Conversation cleared.', 'info')
  },
}

const mcpCommand: SlashCommand = {
  name: 'mcp',
  description: 'Show MCP server connection status',
  execute: async (ctx) => {
    const connections = getAllConnections()
    if (connections.length === 0) {
      ctx.addSystemMessage('mcp_status', 'No MCP servers configured. Add an mcp.json to use MCP tools.', 'info')
      return
    }

    const lines = connections.map(c => {
      if (c.type === 'connected') {
        const caps = Object.keys(c.capabilities).join(', ') || 'none'
        return `  ${c.name}: connected (capabilities: ${caps})`
      }
      return `  ${c.name}: failed — ${c.error}`
    })

    ctx.addSystemMessage(
      'mcp_status',
      `MCP servers:\n${lines.join('\n')}`,
      'info',
    )
  },
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * All registered slash commands, sorted alphabetically by name.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  clearCommand,
  compactCommand,
  mcpCommand,
]

/**
 * Look up a command by exact name. Returns `undefined` for unknown commands.
 */
export function findCommand(name: string): SlashCommand | undefined {
  return SLASH_COMMANDS.find(c => c.name === name)
}

/**
 * Filter commands whose name starts with the given prefix.
 * Returns all commands when the prefix is empty.
 */
export function filterCommands(
  commands: readonly SlashCommand[],
  prefix: string,
): SlashCommand[] {
  if (!prefix) return [...commands]
  const lower = prefix.toLowerCase()
  return commands.filter(c => c.name.toLowerCase().startsWith(lower))
}
