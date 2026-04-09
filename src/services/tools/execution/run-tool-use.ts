import type { Tool, ToolUseContext } from '../types.js'
import { findToolByName } from '../registry.js'
import { createUserMessage } from '../../messages/factory.js'
import { getErrorMessage } from '../../../utils/error.js'
import { isEmptyContent, maybeTruncateLargeResult } from './result-size.js'
import { Stream } from './stream.js'
import type {
  ToolUseBlock,
  CanUseToolFn,
  ContextModifier,
  ToolExecutionEvent,
  ProgressEvent,
} from './types.js'

/**
 * Execute a single tool: validate → permissions → call → format → return.
 *
 * Yields progress events during execution and the final tool_result at the end.
 * Every tool_use block gets exactly one tool_result (even on error/abort).
 */
export async function* runToolUse(
  block: ToolUseBlock,
  tools: Tool<unknown, unknown>[],
  canUseTool: CanUseToolFn,
  context: ToolUseContext,
  assistantMessageUUID: string,
): AsyncGenerator<ToolExecutionEvent> {
  const { id: toolUseID, name: toolName, input } = block

  const tool = findToolByName(tools, toolName)
  if (!tool) {
    yield makeErrorResult(toolUseID, `Tool not found: ${toolName}`, assistantMessageUUID)
    return
  }

  if (context.abortController.signal.aborted) {
    yield makeErrorResult(toolUseID, `Aborted: ${toolName}`, assistantMessageUUID)
    return
  }

  // MCP tools provide raw JSON Schema — the remote server validates input,
  // so we pass it through without Zod parsing.
  let validatedInput: unknown
  if (tool.inputJSONSchema) {
    validatedInput = input
  } else {
    const parseResult = tool.inputSchema.safeParse(input)
    if (!parseResult.success) {
      const formatted = parseResult.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; ')
      yield makeErrorResult(
        toolUseID,
        `Input validation error for ${toolName}: ${formatted}`,
        assistantMessageUUID,
      )
      return
    }
    validatedInput = parseResult.data
  }

  if (tool.validateInput) {
    const validation = await tool.validateInput(validatedInput, context)
    if (!validation.result) {
      yield makeErrorResult(toolUseID, validation.message, assistantMessageUUID)
      return
    }
  }

  const permission = await canUseTool(tool, validatedInput, context)
  if (permission.behavior === 'deny') {
    yield makeErrorResult(toolUseID, permission.message, assistantMessageUUID)
    return
  }
  // 'ask' is treated as deny for the MVP (no interactive permission prompts)
  if (permission.behavior === 'ask') {
    yield makeErrorResult(
      toolUseID,
      `Permission required: ${permission.message}`,
      assistantMessageUUID,
    )
    return
  }
  const permittedInput = permission.updatedInput

  // Bridge tool.call's synchronous onProgress callback into our async generator.
  // The tool may emit progress events any number of times before its Promise
  // resolves; we yield each one as it arrives, then yield the final tool_result.
  const progressStream = new Stream<ProgressEvent>()
  const progressContext: ToolUseContext = {
    ...context,
    onProgress: (data: unknown) => {
      progressStream.enqueue({
        type: 'progress',
        toolUseId: toolUseID,
        toolName,
        data,
        timestamp: new Date().toISOString(),
      })
    },
  }

  // .finally() runs synchronously when the call settles, so the stream is
  // closed before the for-await drain reaches its next pull — no lost events.
  const callPromise = tool
    .call(permittedInput, progressContext)
    .finally(() => progressStream.done())
  // Mark as handled so a rejection during the drain below doesn't surface
  // as an unhandled-rejection warning before we reach the `await` site.
  callPromise.catch(() => {})

  for await (const event of progressStream) {
    yield event
  }

  let toolResult: Awaited<ReturnType<Tool['call']>>
  try {
    toolResult = await callPromise
  } catch (error: unknown) {
    yield makeErrorResult(
      toolUseID,
      `Tool execution error (${toolName}): ${getErrorMessage(error)}`,
      assistantMessageUUID,
    )
    return
  }

  let resultBlock = tool.mapToolResultToToolResultBlockParam(toolResult.data, toolUseID)

  if (isEmptyContent(resultBlock.content)) {
    resultBlock = {
      ...resultBlock,
      content: `(${toolName} completed with no output)`,
    }
  }

  resultBlock = maybeTruncateLargeResult(resultBlock, toolName, tool.maxResultSizeChars)

  const contextModifiers: ContextModifier[] = []
  if (toolResult.contextModifier) {
    contextModifiers.push({
      toolUseID,
      modifyContext: toolResult.contextModifier,
    })
  }

  const message = createUserMessage({
    content: [resultBlock],
    isMeta: true,
    toolUseResult: toolResult.data,
    toolName: tool.name,
    sourceToolAssistantUUID: assistantMessageUUID,
  })

  yield {
    type: 'tool_result' as const,
    message,
    contextModifiers,
    newMessages: toolResult.newMessages,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeErrorResult(
  toolUseID: string,
  errorMessage: string,
  assistantMessageUUID: string,
): ToolExecutionEvent {
  return {
    type: 'tool_result' as const,
    message: createUserMessage({
      content: [{
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: errorMessage,
        is_error: true,
      }],
      isMeta: true,
      sourceToolAssistantUUID: assistantMessageUUID,
    }),
    contextModifiers: [],
  }
}
