import { describe, test, expect, beforeEach } from 'bun:test'
import type { ContentBlock } from '@anthropic-ai/sdk/resources/messages/messages'
import { renderTest } from '../testing/render.js'
import { REPL, type REPLDeps } from '../repl.js'
import type { QueryDeps, CallModelParams } from '../services/agent/types.js'
import type { ToolBatchEvent } from '../services/tools/execution/types.js'
import type { QueryEvent } from '../types/streamEvents.js'
import type { AssistantMessage } from '../types/message.js'
import { initializeToolPermissionContext } from '../services/permissions/initialize.js'
import { makeAssistantMessage } from '../testing/make-assistant-message.js'
import { createUserMessage } from '../services/messages/factory.js'
import { __resetCommandQueueForTests, getQueueSnapshot } from '../utils/messageQueue.js'
import { __resetAgentBusyForTests } from '../utils/agentBusy.js'

const TICK = 100

// --- Fake deps -------------------------------------------------------------
//
// A fake `callModel` that blocks until `resolveCurrent()` is called, so tests
// can pin the agent in the "busy" state, enqueue work, then release the turn
// and observe the drain.

type SlowDeps = REPLDeps & {
  /** Text the model will yield for each sequential call. */
  responses: string[]
  /** Release the currently-awaiting callModel. Resolves that one turn. */
  resolveCurrent: () => void
  /** Texts received by callModel in call order — last element is latest. */
  seenPrompts: string[]
}

function createSlowDeps(responses: string[]): SlowDeps {
  let callIndex = 0
  let pendingResolve: (() => void) | undefined
  const seenPrompts: string[] = []

  const deps: SlowDeps = {
    tools: [],
    initialPermissionContext: initializeToolPermissionContext().context,
    responses,
    seenPrompts,
    resolveCurrent: () => {
      const r = pendingResolve
      pendingResolve = undefined
      r?.()
    },
    createQueryDeps: (): QueryDeps => ({
      async *callModel(params: CallModelParams): AsyncGenerator<QueryEvent> {
        // Capture the last user message text so tests can assert on batching.
        const lastUser = [...params.messages].reverse().find(m => m.role === 'user')
        if (lastUser) {
          const content = lastUser.content
          const text = typeof content === 'string'
            ? content
            : content
                .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                .map(b => b.text)
                .join('')
          seenPrompts.push(text)
        }
        await new Promise<void>(r => { pendingResolve = r })
        yield makeAssistantMessage(responses[callIndex++] ?? 'done')
      },
      async *executeToolBatch(): AsyncGenerator<ToolBatchEvent> {},
      uuid: () => crypto.randomUUID(),
    }),
  }
  return deps
}

describe('REPL message queue', () => {
  beforeEach(() => {
    __resetCommandQueueForTests()
    __resetAgentBusyForTests()
  })

  test('buffers submissions while the agent is busy and renders them in the preview', async () => {
    const deps = createSlowDeps(['first response'])
    const { lastFrame, stdin } = renderTest(<REPL deps={deps} />)

    // Start a turn — this blocks in callModel until resolveCurrent is called.
    stdin.write('first message')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK))
    expect(lastFrame()).toContain('Thinking...')

    // Submit a second message while the agent is still busy — it should
    // land in the queue rather than kicking off another turn.
    stdin.write('queued one')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK))

    // And a third, to validate stacking.
    stdin.write('queued two')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK))

    const frame = lastFrame()!
    expect(frame).toContain('↳ queued one')
    expect(frame).toContain('↳ queued two')
    expect(getQueueSnapshot().map(c => c.value)).toEqual(['queued one', 'queued two'])
    // Only one turn should have been dispatched so far.
    expect(deps.seenPrompts.length).toBe(1)
    expect(deps.seenPrompts[0]).toBe('first message')

    // Release the in-flight turn.
    deps.resolveCurrent()
    await new Promise(r => setTimeout(r, TICK * 3))

    // Release the drained turn that the effect kicked off.
    deps.resolveCurrent()
    await new Promise(r => setTimeout(r, TICK * 3))

    // The drained messages must be delivered as ONE batched user turn
    // (joined with a blank line), not as N sequential turns.
    expect(deps.seenPrompts.length).toBe(2)
    expect(deps.seenPrompts[1]).toBe('queued one\n\nqueued two')

    // Preview should be empty now.
    expect(getQueueSnapshot()).toEqual([])
    const finalFrame = lastFrame()!
    expect(finalFrame).not.toContain('↳ queued one')
  })

  test('Esc with a non-empty queue clears the queue without aborting the turn', async () => {
    const deps = createSlowDeps(['the only response'])
    const { lastFrame, stdin } = renderTest(<REPL deps={deps} />)

    stdin.write('running')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK))
    expect(lastFrame()).toContain('Thinking...')

    stdin.write('to be cleared')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK))
    expect(getQueueSnapshot().length).toBe(1)

    // Escape — queue non-empty, so it should clear the queue and NOT abort.
    stdin.write('\u001b')
    await new Promise(r => setTimeout(r, TICK))

    expect(getQueueSnapshot().length).toBe(0)
    expect(lastFrame()).toContain('Thinking...') // still running

    // Let the turn finish. No drained turn should follow since the queue
    // was cleared.
    deps.resolveCurrent()
    await new Promise(r => setTimeout(r, TICK * 3))

    expect(deps.seenPrompts.length).toBe(1)
    expect(lastFrame()).not.toContain('Thinking...')
  })

  test('submitting while idle runs immediately and bypasses the queue', async () => {
    const deps = createSlowDeps(['idle response'])
    const { lastFrame, stdin } = renderTest(<REPL deps={deps} />)

    stdin.write('idle submit')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK))

    // The queue should be empty — we ran directly, not enqueued.
    expect(getQueueSnapshot()).toEqual([])
    expect(lastFrame()).toContain('Thinking...')

    deps.resolveCurrent()
    await new Promise(r => setTimeout(r, TICK * 3))

    expect(deps.seenPrompts).toEqual(['idle submit'])
  })

  // ── Mid-run drain -----------------------------------------------------
  //
  // Regression test for the reported bug: "agent only load queue message
  // only when agent stop working when reached maximum number of turns."
  // A multi-iteration run should pick up queued messages at the NEXT
  // iteration boundary inside the loop, not only at terminal state.
  test('a message queued during a tool-use iteration is delivered to the very next callModel', async () => {
    const toolUseAssistant: AssistantMessage = {
      type: 'assistant',
      uuid: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      message: {
        id: 'msg_tool_use',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_tick',
            name: 'tick',
            input: {},
          },
        ] as ContentBlock[],
        stop_reason: 'tool_use',
        stop_sequence: null,
        stop_details: null,
        container: null,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
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

    // Capture each callModel invocation's message slice so we can assert on it.
    const capturedCalls: CallModelParams[] = []
    // Deferreds per iteration that the test drives explicitly.
    const iterationGates: Array<() => void> = []
    let iterationGateResolvers: Array<(() => void) | undefined> = []
    function awaitIteration(index: number): Promise<void> {
      return new Promise<void>(resolve => {
        iterationGateResolvers[index] = resolve
      })
    }

    // One deferred per tool-result batch so the test can hold the agent
    // inside "tool execution" long enough to queue a message.
    let toolGateResolve: (() => void) | undefined
    const toolGate = new Promise<void>(r => { toolGateResolve = r })

    const deps: REPLDeps = {
      tools: [],
      initialPermissionContext: initializeToolPermissionContext().context,
      createQueryDeps: (): QueryDeps => ({
        async *callModel(params: CallModelParams): AsyncGenerator<QueryEvent> {
          capturedCalls.push(params)
          const idx = capturedCalls.length - 1
          await awaitIteration(idx)
          if (idx === 0) {
            yield toolUseAssistant
          } else {
            yield makeAssistantMessage('final response')
          }
        },
        async *executeToolBatch(): AsyncGenerator<ToolBatchEvent> {
          await toolGate
          yield {
            type: 'tool_result',
            message: createUserMessage({
              content: [{
                type: 'tool_result',
                tool_use_id: 'toolu_tick',
                content: 'tick result',
              }],
              isMeta: true,
              toolUseResult: { toolUseId: 'toolu_tick', content: 'tick result', isError: false },
              sourceToolAssistantUUID: toolUseAssistant.uuid,
            }),
          }
        },
        uuid: () => crypto.randomUUID(),
      }),
    }

    const { lastFrame, stdin } = renderTest(<REPL deps={deps} />)

    // Kick off the initial run.
    stdin.write('build a sqlite app')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK))
    expect(lastFrame()).toContain('Thinking...')

    // Let callModel iteration 1 resolve → it yields the tool_use assistant.
    iterationGateResolvers[0]?.()
    await new Promise(r => setTimeout(r, TICK))

    // Now the agent is mid tool execution (awaiting toolGate). Queue a
    // follow-up message — this is the user's "change of mind."
    stdin.write('actually, use postgres instead')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK))

    expect(getQueueSnapshot().length).toBe(1)
    expect(lastFrame()).toContain('↳ actually, use postgres instead')

    // Release the tool batch. The query loop proceeds to iteration 2 —
    // at the top of that iteration, drainQueuedInput runs and folds the
    // queued message into state.messages before the next callModel.
    toolGateResolve?.()
    await new Promise(r => setTimeout(r, TICK * 3))

    // Release iteration 2's callModel, which yields the final response.
    iterationGateResolvers[1]?.()
    await new Promise(r => setTimeout(r, TICK * 3))

    // The bug: previously, iteration 2's callModel ONLY saw the original
    // "build a sqlite app" + tool_result messages. The fix: it must ALSO
    // see the queued "actually, use postgres instead" message.
    expect(capturedCalls.length).toBe(2)
    const secondCallMessages = capturedCalls[1]!.messages
    const containsQueuedText = secondCallMessages.some(m => {
      if (m.role !== 'user') return false
      if (typeof m.content === 'string') {
        return m.content === 'actually, use postgres instead'
      }
      return m.content.some(
        b => b.type === 'text' && b.text === 'actually, use postgres instead',
      )
    })
    expect(containsQueuedText).toBe(true)

    // Queue should be empty after the drain.
    expect(getQueueSnapshot()).toEqual([])
  })
})
