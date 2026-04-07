import { useState, useCallback, useRef, useMemo } from 'react'
import { Box, Text, useInput, useApp } from './ink.js'
import { TextInput } from './components/text-input.js'
import { ModeIndicator } from './components/mode-indicator.js'
import { PermissionRequest } from './components/permission-dialog.js'
import { AssistantToolUseBlock, ToolUseProgressBlock, UserToolResultBlock } from './components/tool-messages.js'
import type { Message } from './types/message.js'
import type { AgentEvent, QueryDeps } from './services/agent/types.js'
import type { ProgressMessage } from './services/tools/types.js'
import { createUserMessage, createSystemMessage } from './services/messages/factory.js'
import { isToolResultBlock } from './services/messages/predicates.js'
import { query } from './services/agent/query.js'
import { createQueryDeps } from './services/agent/deps.js'
import { createAnthropicClient } from './services/api/client.js'
import { buildTool } from './services/tools/build-tool.js'
import { readToolDef } from './tools/readTool.js'
import { writeToolDef } from './tools/writeTool.js'
import { editToolDef } from './tools/editTool.js'
import { globToolDef } from './tools/globTool.js'
import { grepToolDef } from './tools/grepTool.js'
import { bashToolDef } from './tools/bashTool.js'
import { FileStateCache } from './utils/fileStateCache.js'
import type { Tool } from './services/tools/types.js'
import { getErrorMessage } from './utils/error.js'
import { initializeToolPermissionContext } from './services/permissions/initialize.js'
import { cyclePermissionMode } from './services/permissions/mode-cycling.js'
import type { ToolUseConfirm } from './services/permissions/confirm.js'
import type { ToolPermissionContext } from './services/permissions/types.js'
import {
  buildEffectiveSystemPrompt,
  getSystemPrompt,
  getSystemContext,
  getUserContext,
} from './services/system-prompt/index.js'

const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 8096

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
): Promise<string[]> {
  const enabledTools = new Set(tools.map(t => t.name))
  const [defaultPrompt, userCtx, sysCtx] = await Promise.all([
    getSystemPrompt({ enabledTools, modelId: MODEL }),
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
    return (
      <Box flexDirection="column">
        {blocks.map((block, i) => {
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

export interface REPLDeps {
  tools: Tool<unknown, unknown>[]
  initialPermissionContext: ToolPermissionContext
  createQueryDeps: (
    abortController: AbortController,
    permissionContext: ToolPermissionContext,
    pushConfirm: (confirm: ToolUseConfirm) => void,
  ) => QueryDeps
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
  const tools: Tool<unknown, unknown>[] = [readTool, writeTool, editTool, globTool, grepTool, bashTool]

  const { context: initialPermissionContext } = initializeToolPermissionContext()

  return {
    tools,
    initialPermissionContext,
    createQueryDeps: (
      abortController: AbortController,
      permissionContext: ToolPermissionContext,
      pushConfirm: (confirm: ToolUseConfirm) => void,
    ) =>
      createQueryDeps({
        client,
        model: MODEL,
        maxTokens: MAX_TOKENS,
        tools,
        abortController,
        permissionContext,
        pushConfirm,
      }),
  }
}

// ---------------------------------------------------------------------------
// REPL component
// ---------------------------------------------------------------------------

export interface REPLProps {
  deps?: REPLDeps
}

export function REPL({ deps: injectedDeps }: REPLProps) {
  const { exit } = useApp()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [latestProgressByToolUseId, setLatestProgressByToolUseId] = useState<Map<string, ProgressMessage>>(
    () => new Map(),
  )
  const isLoadingRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const messagesRef = useRef<Message[]>(messages)
  messagesRef.current = messages

  const replDeps = useMemo(
    () => injectedDeps ?? createDefaultREPLDeps(),
    [injectedDeps],
  )

  // ---------------------------------------------------------------------------
  // Permission context state — mutable via mode cycling and "always allow" rules
  // ---------------------------------------------------------------------------

  const [permissionContext, setPermissionContext] = useState<ToolPermissionContext>(
    () => replDeps.initialPermissionContext,
  )
  const permissionContextRef = useRef(permissionContext)
  permissionContextRef.current = permissionContext

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
      setMessages(prev => [...prev, event])
    } else if (event.type === 'progress') {
      setLatestProgressByToolUseId(prev => {
        const next = new Map(prev)
        next.set(event.toolUseId, event)
        return next
      })
    }
    // stream_event: ignored for now (streaming display is a future enhancement)
  }, [])

  const handleSubmit = useCallback(async (value: string) => {
    if (!value.trim() || isLoadingRef.current) return

    const userMessage = createUserMessage({ content: value })
    const updatedMessages = [...messagesRef.current, userMessage]
    setMessages(updatedMessages)
    setLatestProgressByToolUseId(new Map())
    setInput('')

    const abortController = new AbortController()
    abortControllerRef.current = abortController
    isLoadingRef.current = true
    setIsLoading(true)

    try {
      const [deps, systemPrompt] = await Promise.all([
        Promise.resolve(
          replDeps.createQueryDeps(
            abortController,
            permissionContextRef.current,
            pushConfirm,
          ),
        ),
        buildPromptForSubmit(replDeps.tools),
      ])

      for await (const event of query({
        messages: updatedMessages,
        systemPrompt,
        abortSignal: abortController.signal,
        deps,
      })) {
        onQueryEvent(event)
      }
    } catch (error: unknown) {
      setMessages(prev => [
        ...prev,
        createSystemMessage({
          subtype: 'repl_error',
          content: getErrorMessage(error),
          level: 'error',
        }),
      ])
    } finally {
      isLoadingRef.current = false
      setIsLoading(false)
      abortControllerRef.current = null
      // Drop any progress entries left over from in-flight tools (abort, error,
      // or a tool whose result never reached us). Otherwise stale "(running …)"
      // UI sticks around until the next submit.
      setLatestProgressByToolUseId(prev => (prev.size === 0 ? prev : new Map()))
    }
  }, [replDeps, onQueryEvent, pushConfirm])

  useInput((_ch, key) => {
    if (key.escape && abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    if (key.ctrl && _ch === 'd') exit()

    // Shift+Tab: cycle permission mode
    if (key.shift && key.tab) {
      setPermissionContext(prev => cyclePermissionMode(prev))
    }
  })

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
      {isLoading && <Text color="yellow">Thinking...</Text>}
      {activeConfirm && (
        <PermissionRequest
          confirm={activeConfirm}
          onDone={shiftConfirm}
        />
      )}
      <ModeIndicator mode={permissionContext.mode} />
      <Box>
        <Text color="cyan">{'❯ '}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          isActive={!activeConfirm}
        />
      </Box>
    </Box>
  )
}
