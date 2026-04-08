import type Anthropic from '@anthropic-ai/sdk'
import type {
  CompactTrigger,
  ContentBlockParam,
  Message,
  SystemMessage,
  UserMessage,
} from '../../types/message.js'
import {
  createCompactBoundaryMessage,
  createUserMessage,
  extractTextFromContent,
} from '../messages/factory.js'
import { toApiMessageParams } from '../messages/normalize.js'
import { queryWithoutStreaming } from '../api/query.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-session tracking state for auto-compact. Threaded through the query
 * loop so the loop can detect "we already compacted this session" — the
 * future thrash-prevention task (CODE-32) will hang `consecutiveFailures`
 * off this same struct.
 */
export interface AutoCompactTrackingState {
  /** True once at least one compaction has run in this session. */
  compacted: boolean
}

export function createInitialAutoCompactTracking(): AutoCompactTrackingState {
  return { compacted: false }
}

export interface CompactionResult {
  boundaryMarker: SystemMessage
  /**
   * The summary as a `user` message (always exactly one). Kept as an array
   * to leave room for future "summary + attachments" splits without changing
   * the consumer signature.
   */
  summaryMessages: UserMessage[]
  /** Optional re-injected attachments (recently-read files, plan state). */
  attachments: UserMessage[]
  /** Optional re-injected hook outputs (CLAUDE.md, session-start hooks). */
  hookResults: UserMessage[]
  preCompactTokenCount: number
  postCompactTokenCount?: number
}

/**
 * Function that performs the actual API call to summarize messages. Injected
 * so the query loop can stay testable without a real Anthropic client.
 */
export type SummarizeFn = (params: {
  messages: Message[]
  summaryPrompt: string
  abortSignal?: AbortSignal
}) => Promise<string>

// ---------------------------------------------------------------------------
// Token estimation & thresholds
// ---------------------------------------------------------------------------

/** Default context window for unrecognized models. Conservative. */
const DEFAULT_CONTEXT_WINDOW = 200_000

/** Reserve space for the summary output so the API doesn't reject the call. */
const RESERVED_OUTPUT_TOKENS = 20_000

/** Headroom so we trigger compact *before* hitting the wall. */
const BUFFER_TOKENS = 13_000

/**
 * Per-model context window sizes. Lookup is forgiving — falls back to
 * DEFAULT_CONTEXT_WINDOW if the exact model id isn't recognized.
 */
const CONTEXT_WINDOW_BY_MODEL: Record<string, number> = {
  'claude-opus-4-6': 200_000,
  'claude-opus-4-6[1m]': 1_000_000,
  'claude-sonnet-4-6': 200_000,
  'claude-sonnet-4-20250514': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
}

export function getContextWindowForModel(model: string): number {
  return CONTEXT_WINDOW_BY_MODEL[model] ?? DEFAULT_CONTEXT_WINDOW
}

/**
 * The threshold at which auto-compact fires. Computed as
 * `contextWindow - reservedOutput - buffer` so the compaction itself has
 * room to run without bumping the wall.
 */
export function getAutoCompactThreshold(model: string): number {
  const windowSize = getContextWindowForModel(model)
  const effective = windowSize - RESERVED_OUTPUT_TOKENS
  return effective - BUFFER_TOKENS
}

/**
 * Reads `usage.input_tokens` from the most recent assistant message. This
 * is the ground-truth count for "how big was context on the last turn" —
 * the API itself reported it. Returns 0 if there are no assistant messages
 * yet.
 */
export function getTokenCountFromLastResponse(messages: readonly Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type !== 'assistant') continue
    const usage = m.message.usage
    const input = usage.input_tokens ?? 0
    const cacheRead = usage.cache_read_input_tokens ?? 0
    const cacheCreate = usage.cache_creation_input_tokens ?? 0
    // Cache reads still count toward the context window — sum them all.
    return input + cacheRead + cacheCreate
  }
  return 0
}

export interface ShouldAutoCompactParams {
  messages: readonly Message[]
  model: string
}

/**
 * Decide whether the conversation has crossed the auto-compact threshold,
 * and surface the token count so callers don't need to walk the message
 * array a second time to record `preCompactTokenCount`.
 */
export interface AutoCompactDecision {
  shouldCompact: boolean
  tokenCount: number
}

export function evaluateAutoCompact(params: ShouldAutoCompactParams): AutoCompactDecision {
  const tokenCount = getTokenCountFromLastResponse(params.messages)
  if (tokenCount === 0) return { shouldCompact: false, tokenCount }
  const shouldCompact = tokenCount >= getAutoCompactThreshold(params.model)
  return { shouldCompact, tokenCount }
}

export function shouldAutoCompact(params: ShouldAutoCompactParams): boolean {
  return evaluateAutoCompact(params).shouldCompact
}

// ---------------------------------------------------------------------------
// Summary prompt
// ---------------------------------------------------------------------------

/**
 * The prompt sent to the model to produce the conversation summary.
 *
 * Key invariants of this prompt:
 * 1. NO TOOLS preamble: the model is told tools will be rejected. Without
 *    this, the model often tries to call a tool to "look something up"
 *    instead of summarizing what it already saw.
 * 2. Structured output: nine fixed sections so post-compaction context is
 *    predictable for the next turn.
 * 3. <analysis> / <summary> XML scratchpad: model first reasons in
 *    <analysis>, then writes the final answer in <summary>. We strip
 *    <analysis> before injecting back into context.
 */
export function buildSummaryPrompt(customInstructions?: string): string {
  const instructions = customInstructions?.trim()
  const customSection = instructions
    ? `\n\nAdditional focus from the user: ${instructions}\n`
    : ''

  return `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools. Tool calls will be REJECTED.

Your task is to produce a structured summary of the conversation so far so the work can continue in a fresh context window. Be exhaustive and faithful — this summary IS the model's memory of the session after compaction.

First, draft your reasoning inside an <analysis> block (this is a scratchpad and will be stripped before the summary is injected). Then write the final summary inside a <summary> block, organized into the following nine sections:

1. Primary Request and Intent — what the user is ultimately trying to accomplish
2. Key Technical Concepts — frameworks, libraries, patterns referenced
3. Files and Code Sections — list of files touched, with the most relevant snippets verbatim
4. Errors and Fixes — any errors encountered, how they were resolved
5. Problems Solved — features completed, bugs fixed
6. All User Messages — verbatim, in order, every human turn
7. Pending Tasks — what remains to do
8. Current Work — what was happening immediately before the compaction
9. Optional Next Step — the natural next action${customSection}

Output format:
<analysis>
...your reasoning...
</analysis>
<summary>
1. Primary Request and Intent: ...
...
9. Optional Next Step: ...
</summary>

Reminder: TEXT ONLY. Tool calls will be REJECTED.`
}

// ---------------------------------------------------------------------------
// Summary post-processing
// ---------------------------------------------------------------------------

/**
 * Strip the <analysis> scratchpad and unwrap the <summary> block. The
 * result is a plain-text summary suitable for embedding in a user message.
 *
 * If no XML wrappers are present (e.g. the model ignored the format), the
 * raw text is returned trimmed.
 */
export function formatCompactSummary(rawSummary: string): string {
  let text = rawSummary.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trim()

  const summaryMatch = text.match(/<summary>([\s\S]*?)<\/summary>/i)
  if (summaryMatch) {
    text = `Summary:\n${summaryMatch[1]!.trim()}`
  }

  return text.trim()
}

// ---------------------------------------------------------------------------
// Image stripping
//
// Images and PDFs in the conversation can't be summarized and they bloat
// the compaction call. Replace them with a small text placeholder so the
// summary still references that something was there.
// ---------------------------------------------------------------------------

export function stripImagesFromMessages(messages: Message[]): Message[] {
  return messages.map(m => {
    if (m.type !== 'user' && m.type !== 'assistant') return m
    const content = m.message.content
    if (typeof content === 'string') return m
    if (!Array.isArray(content)) return m

    let touched = false
    const stripped: ContentBlockParam[] = content.map(block => {
      if (block && typeof block === 'object' && 'type' in block) {
        const t = (block as { type: string }).type
        if (t === 'image' || t === 'document') {
          touched = true
          return { type: 'text', text: `[${t} stripped for compaction]` }
        }
      }
      return block as ContentBlockParam
    })

    if (!touched) return m
    return {
      ...m,
      message: { ...m.message, content: stripped },
    } as Message
  })
}

// ---------------------------------------------------------------------------
// Continuation message
// ---------------------------------------------------------------------------

/**
 * Wraps the formatted summary in the user-facing continuation message that
 * gets pushed into the post-compact history. The wording differs slightly
 * for auto vs. manual compact: auto-compact instructs the model to resume
 * silently, manual compact lets it respond normally.
 */
export function buildContinuationMessage(
  formattedSummary: string,
  options: { trigger: CompactTrigger; customInstructions?: string },
): string {
  const header =
    'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.'

  const customNote = options.customInstructions?.trim()
    ? `\n\nUser-supplied compaction focus: ${options.customInstructions.trim()}`
    : ''

  const footer = options.trigger === 'auto'
    ? '\n\nContinue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening.'
    : '\n\nThe summary above replaces the earlier conversation context. You may now respond to the user normally.'

  return `${header}\n\n${formattedSummary}${customNote}${footer}`
}

// ---------------------------------------------------------------------------
// compactConversation — orchestrates the full compaction
// ---------------------------------------------------------------------------

export interface CompactConversationParams {
  messages: Message[]
  summarize: SummarizeFn
  trigger: CompactTrigger
  customInstructions?: string
  abortSignal?: AbortSignal
  /**
   * Token count of the conversation right before compaction. Stored on the
   * boundary marker so the UI can show "compacted from N tokens".
   */
  preCompactTokenCount: number
}

export async function compactConversation(
  params: CompactConversationParams,
): Promise<CompactionResult> {
  const cleanedMessages = stripImagesFromMessages(params.messages)
  const summaryPrompt = buildSummaryPrompt(params.customInstructions)

  const rawSummary = await params.summarize({
    messages: cleanedMessages,
    summaryPrompt,
    abortSignal: params.abortSignal,
  })

  if (!rawSummary || rawSummary.trim().length === 0) {
    throw new Error('Compaction failed: model returned empty summary')
  }

  const formatted = formatCompactSummary(rawSummary)
  const continuation = buildContinuationMessage(formatted, {
    trigger: params.trigger,
    customInstructions: params.customInstructions,
  })

  const boundaryMarker = createCompactBoundaryMessage({
    trigger: params.trigger,
    preCompactTokenCount: params.preCompactTokenCount,
    previousLastMessageUuid: params.messages.at(-1)?.uuid,
    content: `Conversation compacted (${params.trigger}, ${params.preCompactTokenCount} tokens → summary)`,
  })

  const summaryMessage = createUserMessage({
    content: continuation,
    isMeta: true,
  })

  return {
    boundaryMarker,
    summaryMessages: [summaryMessage],
    attachments: [],
    hookResults: [],
    preCompactTokenCount: params.preCompactTokenCount,
  }
}

/**
 * Flatten a CompactionResult into the ordered message sequence that should
 * be appended to the session history after compaction:
 *
 *   [boundary, ...hooks, ...attachments, ...summary]
 *
 * The boundary always goes first so `getMessagesAfterCompactBoundary` will
 * include the summary, attachments, and hooks in the next API call.
 */
export function buildPostCompactMessages(result: CompactionResult): Message[] {
  return [
    result.boundaryMarker,
    ...result.hookResults,
    ...result.attachments,
    ...result.summaryMessages,
  ]
}

// ---------------------------------------------------------------------------
// Production summarizer
// ---------------------------------------------------------------------------

/**
 * Builds a `SummarizeFn` backed by a real Anthropic client. Uses
 * `queryWithoutStreaming` with NO tools — the compaction prompt forbids
 * tool calls, and disabling them at the API level guarantees the model
 * can't waste its single turn trying to call one.
 */
export function createAnthropicSummarizer(
  client: Anthropic,
  model: string,
  maxTokens: number,
): SummarizeFn {
  return async ({ messages, summaryPrompt, abortSignal }) => {
    const result = await queryWithoutStreaming(client, {
      model,
      max_tokens: maxTokens,
      messages: toApiMessageParams(messages),
      system: [{ type: 'text', text: summaryPrompt }],
      abortSignal,
    })

    const text = extractTextFromContent(result.message.content)
    if (text.trim().length === 0) {
      throw new Error('Compaction failed: model returned no text content')
    }
    return text
  }
}
