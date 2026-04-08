import { describe, test, expect, mock } from 'bun:test'
import type {
  AssistantMessage,
  Message,
  SystemMessage,
  UserMessage,
} from '../types/message.js'
import {
  buildContinuationMessage,
  buildPostCompactMessages,
  buildSummaryPrompt,
  compactConversation,
  createInitialAutoCompactTracking,
  evaluateAutoCompact,
  formatCompactSummary,
  getAutoCompactThreshold,
  getContextWindowForModel,
  getTokenCountFromLastResponse,
  shouldAutoCompact,
  stripImagesFromMessages,
  type SummarizeFn,
} from '../services/agent/auto-compact.js'
import {
  getMessagesAfterCompactBoundary,
  isCompactBoundary,
} from '../services/messages/predicates.js'
import { createCompactBoundaryMessage } from '../services/messages/factory.js'

// ─── Helpers ────────────────────────────────────────────────────────────

function makeAssistant(inputTokens: number, text = 'hi'): AssistantMessage {
  return {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: 'req-x',
    message: {
      id: 'msg-x',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text, citations: null }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      stop_details: null,
      container: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation: null,
        inference_geo: null,
        server_tool_use: null,
        service_tier: null,
      },
    },
  }
}

function makeUser(text: string): UserMessage {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: [{ type: 'text', text }] },
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('getContextWindowForModel', () => {
  test('returns the configured size for known models', () => {
    expect(getContextWindowForModel('claude-sonnet-4-20250514')).toBe(200_000)
    expect(getContextWindowForModel('claude-opus-4-6[1m]')).toBe(1_000_000)
  })

  test('falls back to a sane default for unknown models', () => {
    expect(getContextWindowForModel('made-up-model')).toBe(200_000)
  })
})

describe('getAutoCompactThreshold', () => {
  test('reserves room for output and a buffer', () => {
    // 200_000 - 20_000 (reserved output) - 13_000 (buffer) = 167_000
    expect(getAutoCompactThreshold('claude-sonnet-4-20250514')).toBe(167_000)
  })

  test('scales with the model context window', () => {
    expect(getAutoCompactThreshold('claude-opus-4-6[1m]')).toBe(967_000)
  })
})

describe('getTokenCountFromLastResponse', () => {
  test('returns 0 for empty history', () => {
    expect(getTokenCountFromLastResponse([])).toBe(0)
  })

  test('returns 0 when no assistant message has been seen yet', () => {
    expect(getTokenCountFromLastResponse([makeUser('hi')])).toBe(0)
  })

  test('reads input_tokens from the most recent assistant message', () => {
    const messages: Message[] = [
      makeUser('first'),
      makeAssistant(1000),
      makeUser('second'),
      makeAssistant(50_000),
    ]
    expect(getTokenCountFromLastResponse(messages)).toBe(50_000)
  })

  test('includes cache reads and creations in the total', () => {
    const a = makeAssistant(10_000)
    a.message.usage.cache_read_input_tokens = 5_000
    a.message.usage.cache_creation_input_tokens = 2_000
    expect(getTokenCountFromLastResponse([a])).toBe(17_000)
  })
})

describe('shouldAutoCompact', () => {
  test('returns false when no messages exist', () => {
    expect(shouldAutoCompact({ messages: [], model: 'claude-sonnet-4-20250514' })).toBe(false)
  })

  test('returns false when below threshold', () => {
    const messages: Message[] = [makeAssistant(10_000)]
    expect(shouldAutoCompact({ messages, model: 'claude-sonnet-4-20250514' })).toBe(false)
  })

  test('returns true when at or above threshold', () => {
    const messages: Message[] = [makeAssistant(170_000)]
    expect(shouldAutoCompact({ messages, model: 'claude-sonnet-4-20250514' })).toBe(true)
  })
})

describe('evaluateAutoCompact', () => {
  test('returns the token count alongside the decision', () => {
    const messages: Message[] = [makeAssistant(170_000)]
    const decision = evaluateAutoCompact({ messages, model: 'claude-sonnet-4-20250514' })
    expect(decision.shouldCompact).toBe(true)
    expect(decision.tokenCount).toBe(170_000)
  })

  test('reports tokenCount=0 when no assistant turn has happened yet', () => {
    const decision = evaluateAutoCompact({ messages: [makeUser('hi')], model: 'claude-sonnet-4-20250514' })
    expect(decision.shouldCompact).toBe(false)
    expect(decision.tokenCount).toBe(0)
  })
})

describe('formatCompactSummary', () => {
  test('strips analysis block and unwraps summary block', () => {
    const raw = `<analysis>thinking out loud here</analysis>
<summary>
1. Primary Request and Intent: do the thing
2. Key Technical Concepts: stuff
</summary>`
    const formatted = formatCompactSummary(raw)
    expect(formatted).toContain('Summary:')
    expect(formatted).toContain('Primary Request and Intent')
    expect(formatted).not.toContain('thinking out loud')
    expect(formatted).not.toContain('<analysis>')
    expect(formatted).not.toContain('<summary>')
  })

  test('returns trimmed text when no XML wrappers are present', () => {
    expect(formatCompactSummary('  just a summary  ')).toBe('just a summary')
  })

  test('handles multiple analysis blocks', () => {
    const raw = `<analysis>one</analysis>middle<analysis>two</analysis>after`
    expect(formatCompactSummary(raw)).toBe('middleafter')
  })
})

describe('buildSummaryPrompt', () => {
  test('includes the no-tools preamble', () => {
    const p = buildSummaryPrompt()
    expect(p).toContain('TEXT ONLY')
    expect(p).toContain('REJECTED')
  })

  test('lists the nine summary sections', () => {
    const p = buildSummaryPrompt()
    for (const section of [
      'Primary Request and Intent',
      'Key Technical Concepts',
      'Files and Code Sections',
      'Errors and Fixes',
      'Problems Solved',
      'All User Messages',
      'Pending Tasks',
      'Current Work',
      'Optional Next Step',
    ]) {
      expect(p).toContain(section)
    }
  })

  test('embeds custom instructions when provided', () => {
    const p = buildSummaryPrompt('focus on the auth flow')
    expect(p).toContain('focus on the auth flow')
  })
})

describe('buildContinuationMessage', () => {
  test('auto trigger tells the model to resume silently', () => {
    const msg = buildContinuationMessage('Summary:\nstuff', { trigger: 'auto' })
    expect(msg).toContain('without asking the user any further questions')
    expect(msg).toContain('Resume directly')
  })

  test('manual trigger invites a normal response', () => {
    const msg = buildContinuationMessage('Summary:\nstuff', { trigger: 'manual' })
    expect(msg).toContain('respond to the user normally')
  })

  test('embeds custom instructions when provided', () => {
    const msg = buildContinuationMessage('Summary:\nstuff', {
      trigger: 'manual',
      customInstructions: 'keep the database schema in mind',
    })
    expect(msg).toContain('keep the database schema in mind')
  })
})

describe('stripImagesFromMessages', () => {
  test('replaces image blocks with text placeholders', () => {
    const u: UserMessage = {
      type: 'user',
      uuid: 'u1',
      timestamp: '2024-01-01T00:00:00Z',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'look at this' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
        ],
      },
    }
    const stripped = stripImagesFromMessages([u]) as UserMessage[]
    const blocks = stripped[0]!.message.content as Array<{ type: string; text?: string }>
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.type).toBe('text')
    expect(blocks[1]!.type).toBe('text')
    expect(blocks[1]!.text).toContain('image stripped')
  })

  test('returns the same message reference when nothing changes', () => {
    const messages: Message[] = [makeUser('plain text')]
    const stripped = stripImagesFromMessages(messages)
    expect(stripped[0]).toBe(messages[0])
  })
})

describe('compactConversation', () => {
  test('produces a boundary marker, summary message, and preserves token count', async () => {
    const summarize: SummarizeFn = mock(async () => {
      return `<analysis>scratch</analysis><summary>1. Primary: x</summary>`
    })

    const messages: Message[] = [
      makeUser('do the thing'),
      makeAssistant(168_000, 'doing the thing'),
    ]

    const result = await compactConversation({
      messages,
      summarize,
      trigger: 'auto',
      preCompactTokenCount: 168_000,
    })

    expect(summarize).toHaveBeenCalledTimes(1)
    expect(result.boundaryMarker.subtype).toBe('compact_boundary')
    expect(result.boundaryMarker.compactMetadata?.trigger).toBe('auto')
    expect(result.boundaryMarker.compactMetadata?.preCompactTokenCount).toBe(168_000)
    expect(result.boundaryMarker.compactMetadata?.previousLastMessageUuid).toBe(
      messages.at(-1)!.uuid,
    )
    expect(result.summaryMessages).toHaveLength(1)

    const summaryUser = result.summaryMessages[0]!
    expect(summaryUser.isMeta).toBe(true)
    const blocks = summaryUser.message.content as Array<{ type: string; text?: string }>
    const text = blocks.map(b => b.text ?? '').join('')
    expect(text).toContain('Summary:')
    expect(text).toContain('Primary: x')
    expect(text).toContain('without asking the user any further questions')
  })

  test('throws when the summarizer returns empty text', async () => {
    const summarize: SummarizeFn = async () => '   '
    await expect(
      compactConversation({
        messages: [makeUser('hi'), makeAssistant(170_000)],
        summarize,
        trigger: 'auto',
        preCompactTokenCount: 170_000,
      }),
    ).rejects.toThrow(/empty summary/)
  })

  test('manual trigger produces a manual boundary marker', async () => {
    const summarize: SummarizeFn = async () => '<summary>x</summary>'
    const result = await compactConversation({
      messages: [makeUser('hi'), makeAssistant(10)],
      summarize,
      trigger: 'manual',
      preCompactTokenCount: 10,
    })
    expect(result.boundaryMarker.compactMetadata?.trigger).toBe('manual')
  })
})

describe('buildPostCompactMessages', () => {
  test('returns boundary first then summary in order', () => {
    const boundary = createCompactBoundaryMessage({
      trigger: 'manual',
      preCompactTokenCount: 100,
    })
    const summary: UserMessage = {
      type: 'user',
      uuid: 'u-summary',
      timestamp: '2024-01-01T00:00:00Z',
      message: { role: 'user', content: 'summary' },
      isMeta: true,
    }
    const messages = buildPostCompactMessages({
      boundaryMarker: boundary,
      summaryMessages: [summary],
      attachments: [],
      hookResults: [],
      preCompactTokenCount: 100,
    })
    expect(messages).toHaveLength(2)
    expect(messages[0]).toBe(boundary)
    expect(messages[1]).toBe(summary)
  })
})

describe('createInitialAutoCompactTracking', () => {
  test('starts uncompacted', () => {
    const tracking = createInitialAutoCompactTracking()
    expect(tracking.compacted).toBe(false)
  })
})

describe('compact boundary helpers', () => {
  test('isCompactBoundary identifies the marker', () => {
    const marker = createCompactBoundaryMessage({
      trigger: 'auto',
      preCompactTokenCount: 1,
    })
    expect(isCompactBoundary(marker)).toBe(true)
  })

  test('getMessagesAfterCompactBoundary returns everything after the latest marker', () => {
    const before1 = makeUser('a')
    const before2 = makeAssistant(10, 'b')
    const marker = createCompactBoundaryMessage({
      trigger: 'auto',
      preCompactTokenCount: 1000,
    })
    const after1 = makeUser('c')
    const after2 = makeAssistant(20, 'd')
    const messages: Message[] = [before1, before2, marker, after1, after2]
    const visible = getMessagesAfterCompactBoundary(messages)
    expect(visible).toEqual([after1, after2])
  })

  test('getMessagesAfterCompactBoundary returns the input unchanged when no marker exists', () => {
    const messages: Message[] = [makeUser('a'), makeAssistant(10, 'b')]
    expect(getMessagesAfterCompactBoundary(messages)).toBe(messages)
  })

  test('getMessagesAfterCompactBoundary uses only the most recent marker', () => {
    const m1 = createCompactBoundaryMessage({ trigger: 'auto', preCompactTokenCount: 1 })
    const u1 = makeUser('after first compact')
    const m2 = createCompactBoundaryMessage({ trigger: 'manual', preCompactTokenCount: 2 })
    const u2 = makeUser('after second compact')
    const messages: Message[] = [makeUser('pre'), m1, u1, m2, u2]
    const visible = getMessagesAfterCompactBoundary(messages)
    expect(visible).toEqual([u2])
  })
})
