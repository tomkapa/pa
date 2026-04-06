import { useState, useCallback, useRef, useMemo } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { TextInput } from './components/text-input.js'
import { ModeIndicator } from './components/mode-indicator.js'
import { PermissionRequest } from './components/permission-dialog.js'
import type { Message } from './types/message.js'
import type { ContentBlock } from '@anthropic-ai/sdk/resources/messages/messages'
import type { AgentEvent, QueryDeps } from './services/agent/types.js'
import { createUserMessage, createSystemMessage } from './services/messages/factory.js'
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

const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 8096

// ---------------------------------------------------------------------------
// System prompt (static MVP — S-015 adds the dynamic version)
// ---------------------------------------------------------------------------

function buildSystemPrompt(tools: Tool<unknown, unknown>[]): string {
  const toolDescriptions = tools
    .map(t => `- ${t.name}`)
    .join('\n')

  return [
    'You are a coding assistant.',
    `You have access to these tools:\n${toolDescriptions}`,
    `Current working directory: ${process.cwd()}`,
    `Today's date: ${new Date().toISOString().split('T')[0]}`,
  ].join('\n\n')
}

// ---------------------------------------------------------------------------
// Message rendering helpers
// ---------------------------------------------------------------------------

function extractText(blocks: readonly { type: string; text?: string }[]): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')
}

function getTextContent(msg: Message): string {
  if (msg.type === 'user') {
    const content = msg.message.content
    if (typeof content === 'string') return content
    return extractText(content)
  }
  if (msg.type === 'assistant') {
    return extractText(msg.message.content as ContentBlock[])
  }
  return msg.content
}

function MessageView({ message }: { message: Message }) {
  if (message.type === 'user' && !message.isMeta) {
    return <Text color="green">{`> ${getTextContent(message)}`}</Text>
  }
  if (message.type === 'assistant') {
    return <Text>{getTextContent(message)}</Text>
  }
  if (message.type === 'system') {
    const color = message.level === 'error' ? 'red'
      : message.level === 'warning' ? 'yellow'
      : 'gray'
    return <Text color={color}>{message.content}</Text>
  }
  // Meta user messages (tool results) — skip in display
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

  const systemPrompt = useMemo(
    () => buildSystemPrompt(replDeps.tools),
    [replDeps.tools],
  )

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
      setMessages(prev => [...prev, event])
    }
    // stream_event: ignored for now (streaming display is a future enhancement)
  }, [])

  const handleSubmit = useCallback(async (value: string) => {
    if (!value.trim() || isLoadingRef.current) return

    const userMessage = createUserMessage({ content: value })
    const updatedMessages = [...messagesRef.current, userMessage]
    setMessages(updatedMessages)
    setInput('')

    const abortController = new AbortController()
    abortControllerRef.current = abortController
    isLoadingRef.current = true
    setIsLoading(true)

    try {
      const deps = replDeps.createQueryDeps(
        abortController,
        permissionContextRef.current,
        pushConfirm,
      )

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
    }
  }, [replDeps, systemPrompt, onQueryEvent, pushConfirm])

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
        <MessageView key={msg.uuid} message={msg} />
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
