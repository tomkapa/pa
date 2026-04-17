import path from 'node:path'
import { useState, useCallback, useRef, useMemo, useEffect, useSyncExternalStore } from 'react'
import { Box, Text, useInput, useApp } from './ink.js'
import { TextInput } from './components/text-input.js'
import { ModeIndicator } from './components/mode-indicator.js'
import { PermissionRequest } from './components/permission-dialog.js'
import { AssistantToolUseBlock, ToolUseProgressBlock, UserToolResultBlock } from './components/tool-messages.js'
import { ThinkingBlock } from './components/thinking-block.js'
import { QueuedCommandsPreview } from './components/queued-commands-preview.js'
import { TaskListPanel } from './components/task-list-panel.js'
import {
  enqueueCommand,
  drainAllCommands,
  clearCommandQueue,
  hasQueuedCommands,
  getQueueSnapshot,
  subscribeToCommandQueue,
} from './utils/messageQueue.js'
import {
  isAgentBusy,
  setAgentBusy,
  subscribeToAgentBusy,
} from './utils/agentBusy.js'
import type { Message } from './types/message.js'
import type { AgentEvent, QueryDeps } from './services/agent/types.js'
import type { ProgressMessage } from './services/tools/types.js'
import { createSystemMessage } from './services/messages/factory.js'
import { buildMessagesForUserTurn } from './services/mentions/message-builder.js'
import { scanFiles } from './services/mentions/scanner.js'
import { filterForToken } from './services/mentions/filter.js'
import {
  isToolResultBlock,
} from './services/messages/predicates.js'
import { query } from './services/agent/query.js'
import { createQueryDeps } from './services/agent/deps.js'
import {
  createAnthropicSummarizer,
} from './services/agent/auto-compact.js'
import type { SummarizeFn } from './services/agent/auto-compact.js'
import { createAnthropicClient } from './services/api/client.js'
import { buildTool } from './services/tools/build-tool.js'
import { readToolDef } from './tools/readTool.js'
import { writeToolDef } from './tools/writeTool.js'
import { editToolDef } from './tools/editTool.js'
import { globToolDef } from './tools/globTool.js'
import { grepToolDef } from './tools/grepTool.js'
import { bashToolDef } from './tools/bashTool.js'
import { enterPlanModeToolDef } from './tools/enterPlanModeTool.js'
import { exitPlanModeToolDef } from './tools/exitPlanModeTool.js'
import { agentToolDef } from './tools/agentTool.js'
import { AgentRegistry, loadCustomAgentDefinitions } from './services/agents/index.js'
import { taskCreateToolDef } from './tools/taskCreateTool.js'
import { taskGetToolDef } from './tools/taskGetTool.js'
import { taskListToolDef } from './tools/taskListTool.js'
import { taskUpdateToolDef } from './tools/taskUpdateTool.js'
import { webFetchToolDef, createWebFetchSummarizer } from './tools/webFetchTool.js'
import { webSearchToolDef } from './tools/webSearchTool.js'
import { toolSearchToolDef } from './tools/toolSearchTool.js'
import { skillToolDef } from './tools/skillTool.js'
import { lspToolDef } from './tools/lspTool.js'
import { teamCreateToolDef } from './tools/teamCreateTool.js'
import { teamDeleteToolDef } from './tools/teamDeleteTool.js'
import { sendMessageToolDef } from './tools/sendMessageTool.js'
import {
  getAgentName,
  getTeamName,
  isTeammate,
  setMemberActive,
  writeToMailbox,
  TEAM_LEADER_NAME,
  type TeammateMessage,
} from './services/teams/index.js'
import { useInboxPoller } from './hooks/useInboxPoller.js'
import { warmupLspServer } from './lsp/manager.js'
import { isDeferredTool } from './services/tools/deferred-tools.js'
import { FileStateCache } from './utils/fileStateCache.js'
import type { Tool } from './services/tools/types.js'
import { loadAllMcpTools } from './services/mcp/index.js'
import { getErrorMessage } from './utils/error.js'
import { initializeToolPermissionContext } from './services/permissions/initialize.js'
import { createPermissionContext } from './services/permissions/context.js'
import { cyclePermissionMode } from './services/permissions/mode-cycling.js'
import type { ToolUseConfirm } from './services/permissions/confirm.js'
import type { ToolPermissionContext, PermissionMode } from './services/permissions/types.js'
import {
  buildEffectiveSystemPrompt,
  getSystemPrompt,
  getSystemContext,
  getUserContext,
} from './services/system-prompt/index.js'
import { cursorDefault, cursorIBeam } from '../ink/termio/csi.js'
import type { SessionWriter } from './services/session/index.js'
import { SLASH_COMMANDS, findCommand, createAgentCommand } from './commands/registry.js'
import type { SlashCommand } from './commands/registry.js'
import { executeSessionStartHooks, executeUserPromptSubmitHooks } from './services/hooks/index.js'
import { CustomCommandRegistry, discoverCommandDirectories } from './services/custom-commands/index.js'

const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 8096

// When a teammate starts with `--permission-mode`, we need to apply that
// mode to the initial permission context built by `initializeToolPermissionContext`.
function applyInitialMode(
  ctx: ToolPermissionContext,
  mode: PermissionMode | undefined,
): ToolPermissionContext {
  if (!mode || mode === ctx.mode) return ctx
  return { ...ctx, mode }
}
const CURSOR_IBEAM = cursorIBeam()
const CURSOR_DEFAULT = cursorDefault()

// For huge repos, graduate to the cached-index follow-up tech-debt task
// instead of raising this cap.
const MENTION_SCAN_MAX_FILES = 1000
const MENTION_PICKER_LIMIT = 15

// ---------------------------------------------------------------------------
// System prompt assembly
//
// `getSystemPrompt` builds the static + dynamic sections; the user/system
// context bundles (CLAUDE.md, current date, git status) are appended as
// extra sections so the API layer can later cache them independently.
// All loaders are memoized at the service layer, so calling this on
// every submit is cheap after the first turn.
// ---------------------------------------------------------------------------

async function buildPromptForSubmit(
  tools: Tool<unknown, unknown>[],
  permissionContext?: ToolPermissionContext,
  registry?: CustomCommandRegistry,
): Promise<string[]> {
  const enabledTools = new Set(tools.map(t => t.name))
  const skills = registry
    ? registry.getModelInvocableCommands().map(cmd => ({
        name: cmd.name,
        description: cmd.description || undefined,
        whenToUse: cmd.whenToUse,
      }))
    : []
  const [defaultPrompt, userCtx, sysCtx] = await Promise.all([
    getSystemPrompt({ enabledTools, modelId: MODEL, permissionContext, skills }),
    getUserContext(),
    getSystemContext(),
  ])

  const contextSections: string[] = []
  if (userCtx.claudeMd) {
    contextSections.push(`# claudeMd\n${userCtx.claudeMd}`)
  }
  contextSections.push(`# currentDate\nToday's date is ${userCtx.currentDate}.`)
  if (sysCtx.gitStatus) {
    contextSections.push(`# gitStatus\n${sysCtx.gitStatus}`)
  }

  return buildEffectiveSystemPrompt({
    defaultSystemPrompt: [...defaultPrompt, ...contextSections],
  })
}

// ---------------------------------------------------------------------------
// Message rendering helpers
// ---------------------------------------------------------------------------

function getUserInputText(msg: Message & { type: 'user' }): string {
  const content = msg.message.content
  if (typeof content === 'string') return content
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')
}

interface MessageViewProps {
  message: Message
  tools: Tool<unknown, unknown>[]
  verbose: boolean
  /** Latest progress message keyed by tool_use_id, for in-flight tool calls. */
  latestProgressByToolUseId: Map<string, ProgressMessage>
  /** Number of tools currently running — passed to progress renderers. */
  inProgressToolCount: number
}

function MessageView({
  message,
  tools,
  verbose,
  latestProgressByToolUseId,
  inProgressToolCount,
}: MessageViewProps) {
  if (message.type === 'user' && !message.isMeta) {
    return <Text color="green">{`> ${getUserInputText(message)}`}</Text>
  }

  if (message.type === 'assistant') {
    const blocks = message.message.content
    const stopReason = message.message.stop_reason
    return (
      <Box flexDirection="column">
        {blocks.map((block, i) => {
          if (block.type === 'thinking') {
            // The trailing thinking block streams until the assistant
            // message itself finalizes (stop_reason set).
            const isStreaming = i === blocks.length - 1 && stopReason === null
            return (
              <ThinkingBlock
                key={i}
                content={block.thinking}
                isStreaming={isStreaming}
              />
            )
          }
          if (block.type === 'text') {
            return block.text ? <Text key={i}>{block.text}</Text> : null
          }
          if (block.type === 'tool_use') {
            const latest = latestProgressByToolUseId.get(block.id)
            if (!latest) {
              return (
                <AssistantToolUseBlock
                  key={i}
                  toolName={block.name}
                  toolInput={block.input}
                  tools={tools}
                  verbose={verbose}
                />
              )
            }
            return (
              <Box key={i} flexDirection="column">
                <AssistantToolUseBlock
                  toolName={block.name}
                  toolInput={block.input}
                  tools={tools}
                  verbose={verbose}
                />
                <ToolUseProgressBlock
                  toolName={block.name}
                  progressMessages={[latest]}
                  tools={tools}
                  verbose={verbose}
                  inProgressToolCount={inProgressToolCount}
                />
              </Box>
            )
          }
          return null
        })}
      </Box>
    )
  }

  if (message.type === 'user' && message.isMeta) {
    const content = message.message.content
    if (!Array.isArray(content)) return null

    const hasToolResult = content.some(b => b.type === 'tool_result')
    if (!hasToolResult) return null

    // Tool result blocks carry is_error at the SDK level; cast to access it
    const toolResultBlock = content.find(b => b.type === 'tool_result') as
      | { type: 'tool_result'; tool_use_id: string; content?: unknown; is_error?: boolean }
      | undefined

    const isError = toolResultBlock?.is_error === true
    const rawContent = toolResultBlock?.content
    const errorContent = isError
      ? (typeof rawContent === 'string' ? rawContent : undefined)
      : undefined

    return (
      <UserToolResultBlock
        toolUseResult={message.toolUseResult}
        toolName={message.toolName}
        isError={isError}
        errorContent={errorContent}
        tools={tools}
        verbose={verbose}
      />
    )
  }

  if (message.type === 'system') {
    const color = message.level === 'error' ? 'red'
      : message.level === 'warning' ? 'yellow'
      : 'gray'
    return <Text color={color}>{message.content}</Text>
  }

  return null
}

// ---------------------------------------------------------------------------
// Deps factory — injectable for testing
// ---------------------------------------------------------------------------

export interface CreateQueryDepsOverrides {
  /** Override the tools available to the model for this turn. */
  tools?: Tool<unknown, unknown>[]
  /** Override the model for this turn (e.g. "haiku", "opus"). */
  model?: string
}

export interface REPLDeps {
  tools: Tool<unknown, unknown>[]
  /** Agent registry for resolving custom subagent types. */
  agentRegistry: AgentRegistry
  /** Custom command + skill registry (shared between SkillTool and REPL). */
  customCommandRegistry: CustomCommandRegistry
  initialPermissionContext: ToolPermissionContext
  /**
   * Mutable holder for the current permission mode. The REPL pushes the
   * live mode here whenever it changes so tools built during deps creation
   * (e.g. Agent → teammate spawning) can read the current value at call time.
   * Optional — tests can omit this and skip permission-mode-aware tool paths.
   */
  permissionModeRef?: { current: PermissionMode }
  createQueryDeps: (
    abortController: AbortController,
    permissionContext: ToolPermissionContext,
    pushConfirm: (confirm: ToolUseConfirm) => void,
    getPermissionContext?: () => ToolPermissionContext,
    setPermissionContext?: (
      updater: (ctx: ToolPermissionContext) => ToolPermissionContext,
    ) => void,
    overrides?: CreateQueryDepsOverrides,
  ) => QueryDeps
  /**
   * Optional summarizer used by the manual `/compact` slash command.
   * Defaults to a real Anthropic call when omitted; tests inject a fake.
   */
  summarize?: SummarizeFn
}

function createDefaultREPLDeps(): REPLDeps {
  const client = createAnthropicClient()
  const fileStateCache = new FileStateCache()
  const readTool = buildTool(readToolDef(fileStateCache))
  const writeTool = buildTool(writeToolDef(fileStateCache))
  const editTool = buildTool(editToolDef(fileStateCache))
  const globTool = buildTool(globToolDef())
  const grepTool = buildTool(grepToolDef())
  const bashTool = buildTool(bashToolDef())
  const enterPlanModeTool = buildTool(enterPlanModeToolDef())
  const exitPlanModeTool = buildTool(exitPlanModeToolDef())
  const taskCreateTool = buildTool(taskCreateToolDef())
  const taskGetTool = buildTool(taskGetToolDef())
  const taskListTool = buildTool(taskListToolDef())
  const taskUpdateTool = buildTool(taskUpdateToolDef())
  const webFetchTool = buildTool(webFetchToolDef({
    summarize: createWebFetchSummarizer(client, MODEL, MAX_TOKENS),
  }))
  const webSearchTool = buildTool(webSearchToolDef())
  const lspTool = buildTool(lspToolDef())

  // The tools array is captured by reference. The agentTool's closure reads
  // it at call time, so late-arriving MCP tools are included automatically.
  const tools: Tool<unknown, unknown>[] = []

  // ToolSearch is conditionally enabled — only when deferred tools exist.
  // It captures `tools` by reference so it can check at call time whether
  // any deferred tools are present (MCP tools may arrive after startup).
  const toolSearchTool = buildTool({
    ...toolSearchToolDef(),
    isEnabled: () => tools.some(isDeferredTool),
  })

  // Custom command + skill registry. Created here so the SkillTool can
  // capture it by reference. Loading happens in the REPL component's
  // useEffect (same lifecycle as before).
  const customCommandRegistry = new CustomCommandRegistry()

  // SkillTool — lets the model invoke skills programmatically. Captures
  // the registry by reference so skills loaded after startup are available.
  const skillTool = buildTool(skillToolDef({ registry: customCommandRegistry }))

  // Agent registry for resolving subagent_type to agent definitions.
  // Created empty here and populated in the background (same pattern as MCP
  // tools). The agentTool captures the reference and reads it at call time.
  const agentRegistry = new AgentRegistry()

  // Live permission mode — kept in sync with the REPL's useState via
  // `syncPermissionMode` and read by tools that need to know the mode at
  // call time (e.g. Agent when spawning a teammate).
  const permissionModeRef: { current: PermissionMode } = { current: 'default' }

  const agentTool = buildTool(agentToolDef({
    tools,
    agentRegistry,
    getPermissionMode: () => permissionModeRef.current,
    createChildQueryDeps: (opts) =>
      createQueryDeps({
        client,
        model: MODEL,
        maxTokens: MAX_TOKENS,
        tools: opts.tools,
        abortController: opts.abortController,
        permissionContext: createPermissionContext({
          mode: 'bypassPermissions',
          isBypassPermissionsModeAvailable: true,
        }),
      }),
  }))

  const teamCreateTool = buildTool(teamCreateToolDef())
  const teamDeleteTool = buildTool(teamDeleteToolDef())
  const sendMessageTool = buildTool(sendMessageToolDef())

  tools.push(
    readTool, writeTool, editTool, globTool, grepTool, bashTool,
    enterPlanModeTool, exitPlanModeTool, agentTool,
    taskCreateTool, taskGetTool, taskListTool, taskUpdateTool,
    webFetchTool, webSearchTool, toolSearchTool, skillTool, lspTool,
    teamCreateTool, teamDeleteTool, sendMessageTool,
  )

  // Start loading MCP tools in the background. The tools array is mutated
  // in-place so all closures that captured it see the new tools. By the time
  // the user submits their first message, MCP tools will be registered.
  loadAllMcpTools(process.cwd()).then(mcpTools => {
    if (mcpTools.length > 0) {
      tools.push(...mcpTools)
    }
  }).catch(() => {
    // loadAllMcpTools already logs errors internally; swallow here.
  })

  warmupLspServer()

  // Load custom agent definitions from .pa/agents/ in the background.
  // The registry is captured by reference — agents are available by the
  // time the user's first Agent tool call resolves a subagent_type.
  loadCustomAgentDefinitions(path.join(process.cwd(), '.pa', 'agents'))
    .then(custom => agentRegistry.registerCustom(custom))
    .catch(() => {
      // Agent loading must not prevent startup. Loader logs warnings internally.
    })

  const { context: initialPermissionContext } = initializeToolPermissionContext()

  const summarize: SummarizeFn = createAnthropicSummarizer(client, MODEL, MAX_TOKENS)

  return {
    tools,
    agentRegistry,
    customCommandRegistry,
    initialPermissionContext,
    permissionModeRef,
    summarize,
    createQueryDeps: (
      abortController: AbortController,
      permissionContext: ToolPermissionContext,
      pushConfirm: (confirm: ToolUseConfirm) => void,
      getPermissionContext?: () => ToolPermissionContext,
      setPermissionContext?: (
        updater: (ctx: ToolPermissionContext) => ToolPermissionContext,
      ) => void,
      overrides?: CreateQueryDepsOverrides,
    ) =>
      createQueryDeps({
        client,
        model: overrides?.model ?? MODEL,
        maxTokens: MAX_TOKENS,
        tools: overrides?.tools ?? tools,
        abortController,
        permissionContext,
        pushConfirm,
        getPermissionContext,
        setPermissionContext,
      }),
  }
}

// ---------------------------------------------------------------------------
// REPL component
// ---------------------------------------------------------------------------

export interface REPLSessionBinding {
  /** Writer to persist messages. The REPL takes ownership of close(). */
  writer: SessionWriter
  /** Messages loaded from disk when resuming — seed the initial state. */
  initialMessages?: Message[]
}

export interface REPLProps {
  deps?: REPLDeps
  session?: REPLSessionBinding
  /** Initial permission mode, inherited from the spawning leader for teammates. */
  initialPermissionMode?: PermissionMode
}

export function REPL({ deps: injectedDeps, session, initialPermissionMode }: REPLProps) {
  const { exit } = useApp()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>(
    () => session?.initialMessages ?? [],
  )
  const [latestProgressByToolUseId, setLatestProgressByToolUseId] = useState<Map<string, ProgressMessage>>(
    () => new Map(),
  )
  const abortControllerRef = useRef<AbortController | null>(null)
  const messagesRef = useRef<Message[]>(messages)
  messagesRef.current = messages

  const replDeps = useMemo(
    () => injectedDeps ?? createDefaultREPLDeps(),
    [injectedDeps],
  )

  // Built-in slash commands + /agent (needs the registry ref from replDeps).
  const agentCommand = useMemo(() => createAgentCommand(replDeps.agentRegistry), [replDeps])
  const builtInCommands = useMemo<readonly SlashCommand[]>(
    () => [...SLASH_COMMANDS, agentCommand].sort((a, b) => a.name.localeCompare(b.name)),
    [agentCommand],
  )
  // Map for O(1) dispatch lookup from runTurn — only includes commands not
  // already in the static SLASH_COMMANDS list (i.e. the /agent command).
  const dynamicBuiltInCommands = useMemo(
    () => new Map(builtInCommands.filter(c => !findCommand(c.name)).map(c => [c.name, c])),
    [builtInCommands],
  )

  // Custom slash commands + skills discovered from ~/.pa/ and .pa/ directories.
  // The registry lives in replDeps so the SkillTool can reference it too.
  const customCommandRegistryRef = useRef(replDeps.customCommandRegistry)
  const [allSlashCommands, setAllSlashCommands] = useState<readonly SlashCommand[]>(builtInCommands)

  useEffect(() => {
    void (async () => {
      try {
        const dirs = await discoverCommandDirectories(process.cwd())
        await customCommandRegistryRef.current.loadFromDirectories(dirs)
        const customSlash = customCommandRegistryRef.current.toSlashCommands()
        setAllSlashCommands([...builtInCommands, ...customSlash].sort((a, b) => a.name.localeCompare(b.name)))
      } catch {
        // Custom command + skill loading must not prevent startup
        setAllSlashCommands(builtInCommands)
      }
    })()
  }, [builtInCommands])

  // Messages already persisted to disk are seeded into the set so we don't
  // re-write history we just read back. Also guards against
  // setMessages-style replacement events carrying an already-persisted uuid.
  const persistedUuidsRef = useRef<Set<string>>(
    new Set((session?.initialMessages ?? []).map(m => m.uuid)),
  )
  const writer = session?.writer

  const persistMessage = useCallback((msg: Message) => {
    if (!writer) return
    if (persistedUuidsRef.current.has(msg.uuid)) return
    persistedUuidsRef.current.add(msg.uuid)
    writer.append(msg)
  }, [writer])

  const addSystemMessage = useCallback(
    (subtype: string, content: string, level: 'info' | 'warning' | 'error') => {
      const msg = createSystemMessage({ subtype, content, level })
      persistMessage(msg)
      setMessages(prev => [...prev, msg])
    },
    [persistMessage],
  )

  // ---------------------------------------------------------------------------
  // Permission context state — mutable via mode cycling and "always allow" rules
  // ---------------------------------------------------------------------------

  const [permissionContext, setPermissionContext] = useState<ToolPermissionContext>(
    () => applyInitialMode(replDeps.initialPermissionContext, initialPermissionMode),
  )
  const permissionContextRef = useRef(permissionContext)
  permissionContextRef.current = permissionContext
  // Keep the tool-visible mode ref in sync so the Agent tool sees the
  // user's latest mode when spawning a teammate mid-session.
  useEffect(() => {
    if (replDeps.permissionModeRef) {
      replDeps.permissionModeRef.current = permissionContext.mode
    }
  }, [permissionContext.mode, replDeps])

  // ---------------------------------------------------------------------------
  // Confirmation queue — pending permission prompts
  // ---------------------------------------------------------------------------

  const [confirmQueue, setConfirmQueue] = useState<ToolUseConfirm[]>([])

  const pushConfirm = useCallback((confirm: ToolUseConfirm) => {
    setConfirmQueue(prev => [...prev, confirm])
  }, [])

  const shiftConfirm = useCallback(() => {
    setConfirmQueue(prev => prev.slice(1))
  }, [])

  const activeConfirm = confirmQueue[0]

  const onQueryEvent = useCallback((event: AgentEvent) => {
    if (event.type === 'assistant') {
      persistMessage(event)
      setMessages(prev => {
        const idx = prev.findIndex(m => m.uuid === event.uuid)
        if (idx >= 0) {
          // Streaming update — replace in-place
          const next = [...prev]
          next[idx] = event
          return next
        }
        return [...prev, event]
      })
    } else if (event.type === 'user' || event.type === 'system') {
      // When a tool_result arrives, drop the matching tool's in-flight progress
      // so it doesn't keep occupying screen space below the rendered result.
      if (event.type === 'user' && event.isMeta && Array.isArray(event.message.content)) {
        const finishedIds = event.message.content
          .filter(isToolResultBlock)
          .map(b => b.tool_use_id)
        if (finishedIds.length > 0) {
          setLatestProgressByToolUseId(prev => {
            if (!finishedIds.some(id => prev.has(id))) return prev
            const next = new Map(prev)
            for (const id of finishedIds) next.delete(id)
            return next
          })
        }
      }
      persistMessage(event)
      setMessages(prev => [...prev, event])
    } else if (event.type === 'progress') {
      setLatestProgressByToolUseId(prev => {
        const next = new Map(prev)
        next.set(event.toolUseId, event)
        return next
      })
    }
    // stream_event: ignored for now (streaming display is a future enhancement)
  }, [persistMessage])

  // ---------------------------------------------------------------------------
  // runTurn — the single place that actually runs an agent turn.
  //
  // Both the direct submit-handler path (when the agent was idle) and the
  // drain effect (when the agent just finished a turn and the queue is
  // non-empty) funnel through here so there is exactly one agent-execution
  // path. runTurn synchronously flips setAgentBusy(true) BEFORE the first
  // await — that is the race guard that prevents a second drain effect from
  // double-dequeuing while this one is awaiting.
  // ---------------------------------------------------------------------------
  const runTurn = useCallback(async (value: string) => {
    // Synchronous, BEFORE any await — see the comment above.
    setAgentBusy(true)
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      // Slash commands run client-side without invoking the model loop.
      // Handlers are defined in commands/registry.ts — single source of truth.
      // Custom commands from .pa/commands/ are handled differently — they
      // expand into a user message and trigger an agent turn.
      let effectiveValue = value
      let customCommandMeta: { allowedTools?: string[]; model?: string } | undefined
      const slashMatch = value.match(/^\/(\S+)/)
      if (slashMatch) {
        // Check built-in commands first (includes /agent)
        const cmd = findCommand(slashMatch[1]!) ?? dynamicBuiltInCommands.get(slashMatch[1]!)
        if (cmd) {
          await cmd.execute({
            args: value.slice(slashMatch[0]!.length).trim(),
            abortSignal: abortController.signal,
            messages: () => messagesRef.current,
            addSystemMessage,
            persistMessage,
            setMessages,
            summarize: replDeps.summarize,
          })
          return
        }

        // Check custom commands — expand and fall through to agent execution
        const customCmd = customCommandRegistryRef.current.findCommand(slashMatch[1]!)
        if (customCmd) {
          const args = value.slice(slashMatch[0]!.length).trim()
          effectiveValue = await customCmd.getPrompt(args)
          if (customCmd.allowedTools || customCmd.model) {
            customCommandMeta = {
              allowedTools: customCmd.allowedTools,
              model: customCmd.model,
            }
          }
        }
      }

      // --- UserPromptSubmit hooks ---
      for await (const hookResult of executeUserPromptSubmitHooks(
        effectiveValue,
        abortController.signal,
      )) {
        if (hookResult.blockingError) {
          addSystemMessage(
            'hook_prompt_blocked',
            `Prompt blocked by hook: ${hookResult.blockingError.message}`,
            'warning',
          )
          return
        }
        if (hookResult.additionalContexts) {
          for (const ctx of hookResult.additionalContexts) {
            addSystemMessage('hook_prompt_context', ctx, 'info')
          }
        }
      }

      // Expands @-file mentions into a synthesized Read tool trace before the
      // user's literal text. Prompts without mentions return a single message.
      const turnMessages = await buildMessagesForUserTurn({
        promptText: effectiveValue,
        cwd: process.cwd(),
      })
      for (const msg of turnMessages) persistMessage(msg)
      const updatedMessages = [...messagesRef.current, ...turnMessages]
      setMessages(updatedMessages)
      setLatestProgressByToolUseId(new Map())

      // When a custom command specifies allowed-tools, restrict the tool set
      // for this turn so the model only sees (and can invoke) those tools.
      const effectiveTools = customCommandMeta?.allowedTools
        ? replDeps.tools.filter(t => customCommandMeta!.allowedTools!.some(
            name => t.name.toLowerCase() === name.toLowerCase(),
          ))
        : replDeps.tools

      const queryDepsOverrides: CreateQueryDepsOverrides | undefined = customCommandMeta && {
        ...(customCommandMeta.allowedTools && { tools: effectiveTools }),
        ...(customCommandMeta.model && { model: customCommandMeta.model }),
      }

      const [baseDeps, systemPrompt] = await Promise.all([
        Promise.resolve(
          replDeps.createQueryDeps(
            abortController,
            permissionContextRef.current,
            pushConfirm,
            () => permissionContextRef.current,
            (updater) => setPermissionContext(updater),
            queryDepsOverrides,
          ),
        ),
        buildPromptForSubmit(effectiveTools, permissionContextRef.current, customCommandRegistryRef.current),
      ])

      // Between-iterations drain: picks up messages the user buffered
      // during the previous tool batch and folds them into the next API
      // call as a fresh user turn. onQueryEvent persists and renders each
      // yielded message, so we don't need to persist here.
      const deps = {
        ...baseDeps,
        drainQueuedInput: async (): Promise<Message[]> => {
          if (!hasQueuedCommands()) return []
          const drained = drainAllCommands()
          const combinedText = drained.map(c => c.value).join('\n\n')
          return buildMessagesForUserTurn({
            promptText: combinedText,
            cwd: process.cwd(),
          })
        },
      }

      let sawModelError = false
      for await (const event of query({
        messages: updatedMessages,
        systemPrompt,
        abortSignal: abortController.signal,
        deps,
      })) {
        onQueryEvent(event)
        if (event.type === 'system' && event.subtype === 'model_error') {
          sawModelError = true
        }
      }
      // Teammate self-exit: a teammate can't do useful work if the model is
      // unreachable. After the query loop's own retry+circuit-breaker has
      // given up, we terminate so the process, its sockets, and its team
      // member record all get reclaimed via the unmount cleanup.
      if (sawModelError && isTeammate()) {
        addSystemMessage(
          'teammate_self_exit',
          'Model unreachable after retries — teammate exiting to release resources.',
          'warning',
        )
        teammateShouldExitRef.current = true
      }
    } catch (error: unknown) {
      addSystemMessage('repl_error', getErrorMessage(error), 'error')
    } finally {
      abortControllerRef.current = null
      // Drop any progress entries left over from in-flight tools (abort, error,
      // or a tool whose result never reached us). Otherwise stale "(running …)"
      // UI sticks around until the next submit.
      setLatestProgressByToolUseId(prev => (prev.size === 0 ? prev : new Map()))
      // Clear busy LAST — the drain effect subscribes to this signal and will
      // fire as soon as it flips, so everything else must already be in its
      // post-turn state.
      setAgentBusy(false)
    }
  }, [replDeps, onQueryEvent, pushConfirm, persistMessage, addSystemMessage, dynamicBuiltInCommands])

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim()
    if (trimmed === '') return

    // Agent mid-turn → buffer the message and clear the input so the user
    // can keep typing. The drain effect picks it up when the current turn
    // finishes. isAgentBusy() is a synchronous module-level read — it is the
    // only correct way to make this decision, because React state is one
    // render behind and would race under rapid submits.
    if (isAgentBusy()) {
      enqueueCommand({
        value: trimmed,
        uuid: crypto.randomUUID(),
        mode: 'prompt',
      })
      setInput('')
      return
    }

    setInput('')
    await runTurn(trimmed)
  }, [runTurn])

  // ---------------------------------------------------------------------------
  // Drain effect — when the agent goes idle and the queue has items, batch
  // them into one combined turn and run it. Subscribing to both queue and
  // busy state via useSyncExternalStore ensures this re-runs whenever either
  // changes.
  // ---------------------------------------------------------------------------
  const queuedCommands = useSyncExternalStore(subscribeToCommandQueue, getQueueSnapshot)
  const agentBusy = useSyncExternalStore(subscribeToAgentBusy, isAgentBusy)

  useEffect(() => {
    if (agentBusy) return
    if (queuedCommands.length === 0) return

    const drained = drainAllCommands()
    // Batch all queued submissions into one user turn — users typing 3
    // thoughts in a row want the agent to address all 3 together, not
    // bounce back to thought 1 in isolation for 3 sequential round-trips.
    // runTurn sync-sets busy=true as its first statement (before any
    // await), which is the race guard that prevents a second drain effect
    // firing in the same microtask from double-dequeuing.
    const combinedText = drained.map(c => c.value).join('\n\n')
    void runTurn(combinedText)
  }, [agentBusy, queuedCommands, runTurn])

  useInput((_ch, key) => {
    if (key.escape) {
      // Esc with queued items → clear the queue (takes precedence over
      // abort so the user can cancel a buffered follow-up without also
      // killing the in-flight turn). Esc with an empty queue keeps the
      // existing "abort current turn" behavior.
      if (hasQueuedCommands()) {
        clearCommandQueue()
      } else if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
    if (key.ctrl && _ch === 'd') exit()

    // Shift+Tab: cycle permission mode
    if (key.shift && key.tab) {
      setPermissionContext(prev => cyclePermissionMode(prev))
    }
  })

  // Per-keystroke rescan of the workspace — no caching in v1 (see constants above).
  const suggestMentions = useCallback(async (token: string) => {
    const files = await scanFiles(process.cwd(), MENTION_SCAN_MAX_FILES)
    return filterForToken(files, token, MENTION_PICKER_LIMIT)
  }, [])

  // --- SessionStart hooks ---
  // Fire once on mount. Fresh session → 'startup', resumed → 'resume'.
  useEffect(() => {
    const source = session?.initialMessages?.length ? 'resume' : 'startup'
    void (async () => {
      try {
        for await (const hookResult of executeSessionStartHooks(source)) {
          if (hookResult.additionalContexts) {
            for (const ctx of hookResult.additionalContexts) {
              addSystemMessage('hook_session_start', ctx, 'info')
            }
          }
          // Blocking errors are ignored for SessionStart — session must start
        }
      } catch {
        // SessionStart hooks must not prevent startup
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => { process.stdout.write(CURSOR_DEFAULT) }
  }, [])

  // Fire-and-forget close on unmount; React's cleanup hook is sync, and
  // cli.tsx awaits the same writer on the process-exit path.
  useEffect(() => {
    if (!writer) return
    return () => { void writer.close() }
  }, [writer])

  // Team coordination: both leaders and teammates poll their own inbox so
  // incoming mail is delivered as a queued user prompt on the next drain.
  // Teammates also notify the leader on exit so work can be reassigned
  // without waiting for a no-reply timeout.
  const teammateMode = isTeammate()
  const teamAgentName = getAgentName() ?? TEAM_LEADER_NAME
  const teamName = getTeamName()

  // Set by runTurn when a teammate's model retries + circuit breaker
  // exhaust. Drives an exit() after the turn unwinds so the unmount
  // cleanup (idle notification, isActive=false) runs.
  const teammateShouldExitRef = useRef(false)
  useEffect(() => {
    if (!agentBusy && teammateShouldExitRef.current) {
      exit()
    }
  })

  const onInboxMessage = useCallback((msg: TeammateMessage) => {
    enqueueCommand({
      value: `[message from ${msg.from}]\n\n${msg.text}`,
      uuid: crypto.randomUUID(),
      mode: 'prompt',
    })
  }, [])

  useInboxPoller({
    agentName: teamAgentName,
    teamName,
    enabled: teamName !== undefined,
    onMessage: onInboxMessage,
  })

  useEffect(() => {
    if (!teammateMode || !teamName) return
    // React cleanup is synchronous — fire-and-forget the async notification.
    return () => {
      void (async () => {
        try {
          await setMemberActive(teamName, teamAgentName, false)
          await writeToMailbox(teamName, TEAM_LEADER_NAME, {
            from: teamAgentName,
            text: `[${teamAgentName}] agent loop exited — I'm available for new work.`,
            timestamp: new Date().toISOString(),
            read: false,
            summary: 'teammate idle',
          })
        } catch {
          // Leader's inbox or team file may have been deleted — ignore.
        }
      })()
    }
  }, [teammateMode, teamName, teamAgentName])

  return (
    <Box flexDirection="column">
      {messages.map(msg => (
        <MessageView
          key={msg.uuid}
          message={msg}
          tools={replDeps.tools}
          verbose={false}
          latestProgressByToolUseId={latestProgressByToolUseId}
          inProgressToolCount={latestProgressByToolUseId.size}
        />
      ))}
      {agentBusy && <Text color="yellow">Thinking...</Text>}
      <TaskListPanel />
      {activeConfirm && (
        <PermissionRequest
          confirm={activeConfirm}
          onDone={shiftConfirm}
        />
      )}
      <QueuedCommandsPreview />
      <ModeIndicator mode={permissionContext.mode} />
      <Box
        onMouseEnter={() => process.stdout.write(CURSOR_IBEAM)}
        onMouseLeave={() => process.stdout.write(CURSOR_DEFAULT)}
      >
        <Text color="cyan">{'❯ '}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          isActive={!activeConfirm}
          suggest={suggestMentions}
          commands={allSlashCommands}
        />
      </Box>
    </Box>
  )
}
