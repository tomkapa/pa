import { resolve } from 'node:path'
import type {
  ContentBlock,
  ContentBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages'
import type { AssistantMessage, Message, UserMessage } from '../../types/message.js'
import { createUserMessage } from '../messages/factory.js'
import { getErrorMessage } from '../../utils/error.js'
import { READ_TOOL_NAME, type ReadToolOutput } from '../../tools/readTool.js'
import { extractAtMentions } from './tokenizer.js'
import { readFileWithTruncation } from './reader.js'

// For each @-mentioned file, synthesize the exact message shape the model
// sees when IT has called the Read tool itself — a tool_use/tool_result pair
// followed by the user's literal text. This reuses the model's trained tool
// trace distribution instead of inventing a custom attachment format, and
// lets the existing readToolUI render the attachment in the transcript.
//
// tool_use and tool_result must be strictly adjacent per the Anthropic API,
// so each mention emits its own pair before the next.

const DEFAULT_MAX_LINES = 2000

export interface BuildMessagesParams {
  promptText: string
  cwd: string
  /** Upper bound on lines read per file. Defaults to 2000. */
  maxLines?: number
}

interface MentionRead {
  rel: string
  /** String to place inside the tool_result block the model sees. */
  modelContent: string
  /** Structured ReadToolOutput the UI renders — undefined on error. */
  toolUseResult?: ReadToolOutput
  isError: boolean
}

export async function buildMessagesForUserTurn(
  params: BuildMessagesParams,
): Promise<Message[]> {
  const { promptText, cwd, maxLines = DEFAULT_MAX_LINES } = params
  const mentions = extractAtMentions(promptText)

  // Read files in parallel — tool_use/tool_result pairs must stay adjacent,
  // but the pairs themselves have no ordering constraint.
  const reads = await Promise.all(
    mentions.map(rel => readMention(resolve(cwd, rel), rel, maxLines)),
  )

  const messages: Message[] = []
  for (const read of reads) {
    const toolUseId = crypto.randomUUID()
    messages.push(createFakeToolUseAssistant(toolUseId, read.rel))
    messages.push(createFakeToolResultUser(toolUseId, read))
  }
  messages.push(createUserMessage({ content: promptText }))
  return messages
}

async function readMention(abs: string, rel: string, maxLines: number): Promise<MentionRead> {
  try {
    const read = await readFileWithTruncation(abs, { maxLines })
    const modelContent = read.truncated
      ? `${read.text}\n\n[file truncated at ${maxLines} lines — call ${READ_TOOL_NAME} with an offset to see the rest]`
      : read.text || '(empty file)'
    const toolUseResult: ReadToolOutput = {
      type: 'text',
      content: read.text,
      numLines: read.numLines,
      startLine: 1,
      totalLines: read.totalLines,
    }
    return { rel, modelContent, toolUseResult, isError: false }
  } catch (err: unknown) {
    return {
      rel,
      modelContent: `[error reading ${rel}: ${getErrorMessage(err)}]`,
      isError: true,
    }
  }
}

function createFakeToolUseAssistant(toolUseId: string, relPath: string): AssistantMessage {
  const toolUseBlock: ContentBlock = {
    type: 'tool_use',
    id: toolUseId,
    name: READ_TOOL_NAME,
    input: { file_path: relPath },
    caller: { type: 'direct' },
  }

  return {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      id: `msg_fake_${toolUseId}`,
      type: 'message',
      role: 'assistant',
      model: 'synthetic',
      content: [toolUseBlock],
      stop_reason: 'tool_use',
      stop_sequence: null,
      stop_details: null,
      container: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation: null,
        inference_geo: null,
        server_tool_use: null,
        service_tier: null,
      },
    },
    requestId: undefined,
  }
}

function createFakeToolResultUser(toolUseId: string, read: MentionRead): UserMessage {
  const toolResultBlock: ContentBlockParam = {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: read.modelContent,
    ...(read.isError ? { is_error: true } : {}),
  }

  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'user',
      content: [toolResultBlock],
    },
    isMeta: true,
    toolName: READ_TOOL_NAME,
    toolUseResult: read.toolUseResult,
  }
}
