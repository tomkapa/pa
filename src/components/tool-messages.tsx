import { Text, Box } from '../ink.js'
import type { ProgressMessage, Tool } from '../services/tools/types.js'
import { findToolByName } from '../services/tools/registry.js'

// ---------------------------------------------------------------------------
// Fallback components — used when a tool doesn't provide custom renderers
// ---------------------------------------------------------------------------

interface FallbackToolUseErrorMessageProps {
  errorText: string
}

export function FallbackToolUseErrorMessage({ errorText }: FallbackToolUseErrorMessageProps) {
  return <Text color="red">{errorText}</Text>
}

export function FallbackToolUseRejectedMessage({ toolName }: { toolName: string }) {
  return <Text color="yellow">Tool use rejected: {toolName}</Text>
}

// ---------------------------------------------------------------------------
// AssistantToolUseBlock — renders a single tool_use block from an assistant message
// ---------------------------------------------------------------------------

interface AssistantToolUseBlockProps {
  toolName: string
  toolInput: unknown
  tools: Tool<unknown, unknown>[]
  verbose: boolean
}

export function AssistantToolUseBlock({
  toolName,
  toolInput,
  tools,
  verbose,
}: AssistantToolUseBlockProps) {
  const tool = findToolByName(tools, toolName)
  const displayName = tool
    ? tool.userFacingName(toolInput as Partial<unknown>)
    : toolName

  const renderOptions = { verbose }
  const body = tool?.renderToolUseMessage?.(
    toolInput as Partial<unknown>,
    renderOptions,
  )

  return (
    <Box>
      <Text bold color="cyan">[{displayName}]</Text>
      {body != null && (
        <>
          <Text> </Text>
          {body}
        </>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// ToolUseProgressBlock — live progress UI shown WHILE a tool is running.
// Dispatches to the tool's renderToolUseProgressMessage; renders nothing
// for tools that don't define one (the rest of the UI keeps the spinner).
// ---------------------------------------------------------------------------

interface ToolUseProgressBlockProps {
  toolName: string
  progressMessages: ProgressMessage[]
  tools: Tool<unknown, unknown>[]
  verbose: boolean
  columns?: number
  inProgressToolCount?: number
}

export function ToolUseProgressBlock({
  toolName,
  progressMessages,
  tools,
  verbose,
  columns,
  inProgressToolCount,
}: ToolUseProgressBlockProps) {
  const tool = findToolByName(tools, toolName)
  if (!tool?.renderToolUseProgressMessage) return null
  if (progressMessages.length === 0) return null

  const rendered = tool.renderToolUseProgressMessage(progressMessages, {
    verbose,
    columns,
    inProgressToolCount,
  })
  if (rendered == null) return null

  return <Box paddingLeft={2}>{rendered}</Box>
}

// ---------------------------------------------------------------------------
// UserToolResultBlock — renders a single tool result from a meta user message
// ---------------------------------------------------------------------------

interface UserToolResultBlockProps {
  toolUseResult: unknown
  toolName: string | undefined
  isError: boolean
  errorContent: string | undefined
  tools: Tool<unknown, unknown>[]
  verbose: boolean
}

export function UserToolResultBlock({
  toolUseResult,
  toolName,
  isError,
  errorContent,
  tools,
  verbose,
}: UserToolResultBlockProps) {
  const renderOptions = { verbose }

  if (isError) {
    const errorText = errorContent ?? 'Tool execution failed'
    const tool = toolName ? findToolByName(tools, toolName) : undefined
    const customError = tool?.renderToolUseErrorMessage?.(errorText, renderOptions)
    return (
      <Box paddingLeft={2}>
        {customError ?? <FallbackToolUseErrorMessage errorText={errorText} />}
      </Box>
    )
  }

  if (!toolName) return null

  const tool = findToolByName(tools, toolName)
  if (!tool?.renderToolResultMessage) return null

  const rendered = tool.renderToolResultMessage(toolUseResult, { verbose })
  if (rendered == null) return null

  return <Box paddingLeft={2}>{rendered}</Box>
}
