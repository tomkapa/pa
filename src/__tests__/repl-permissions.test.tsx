import { describe, test, expect } from 'bun:test'
import { renderTest } from '../testing/render.js'
import { REPL, type REPLDeps } from '../repl.js'
import type { QueryDeps, CallModelParams } from '../services/agent/types.js'
import type { ToolBatchEvent } from '../services/tools/execution/types.js'
import type { QueryEvent } from '../types/streamEvents.js'
import { initializeToolPermissionContext } from '../services/permissions/initialize.js'
import { createPermissionContext } from '../services/permissions/context.js'
import { makeAssistantMessage } from '../testing/make-assistant-message.js'

const TICK = 100

function createFakeDeps(responses: string[] = []): REPLDeps {
  let callIndex = 0

  return {
    tools: [],
    initialPermissionContext: initializeToolPermissionContext(),
    createQueryDeps: (): QueryDeps => ({
      async *callModel(_params: CallModelParams): AsyncGenerator<QueryEvent> {
        const text = responses[callIndex++] ?? 'No more responses'
        yield makeAssistantMessage(text)
      },
      async *executeToolBatch(): AsyncGenerator<ToolBatchEvent> {},
      uuid: () => crypto.randomUUID(),
    }),
  }
}

function createDepsWithBypassAvailable(responses: string[] = []): REPLDeps {
  let callIndex = 0

  return {
    tools: [],
    initialPermissionContext: createPermissionContext({ isBypassPermissionsModeAvailable: true }),
    createQueryDeps: (): QueryDeps => ({
      async *callModel(_params: CallModelParams): AsyncGenerator<QueryEvent> {
        const text = responses[callIndex++] ?? 'No more responses'
        yield makeAssistantMessage(text)
      },
      async *executeToolBatch(): AsyncGenerator<ToolBatchEvent> {},
      uuid: () => crypto.randomUUID(),
    }),
  }
}

/** Simulate Shift+Tab keypress (CSI Z sequence) */
function sendShiftTab(stdin: { write: (data: string) => void }) {
  stdin.write('\x1b[Z')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('REPL permission mode cycling', () => {
  test('default mode shows no indicator', () => {
    const { lastFrame } = renderTest(<REPL deps={createFakeDeps()} />)
    const frame = lastFrame()!
    // Should not show any mode indicator text
    expect(frame).not.toContain('shift+tab to cycle')
    expect(frame).not.toContain('Accept edits')
    expect(frame).not.toContain('Plan mode')
    expect(frame).not.toContain('Bypass permissions')
  })

  test('shift+tab cycles to acceptEdits mode', async () => {
    const { lastFrame, stdin } = renderTest(<REPL deps={createFakeDeps()} />)

    sendShiftTab(stdin)
    await new Promise(r => setTimeout(r, TICK))

    const frame = lastFrame()!
    expect(frame).toContain('Accept edits')
    expect(frame).toContain('shift+tab to cycle')
  })

  test('shift+tab cycles through modes', async () => {
    const { lastFrame, stdin } = renderTest(<REPL deps={createFakeDeps()} />)

    // default → acceptEdits
    sendShiftTab(stdin)
    await new Promise(r => setTimeout(r, TICK))
    expect(lastFrame()!).toContain('Accept edits')

    // acceptEdits → plan
    sendShiftTab(stdin)
    await new Promise(r => setTimeout(r, TICK))
    expect(lastFrame()!).toContain('Plan mode')

    // plan → default (bypass not available)
    sendShiftTab(stdin)
    await new Promise(r => setTimeout(r, TICK))
    expect(lastFrame()!).not.toContain('Plan mode')
    expect(lastFrame()!).not.toContain('Accept edits')
    expect(lastFrame()!).not.toContain('shift+tab to cycle')
  })

  test('shift+tab includes bypassPermissions when available', async () => {
    const { lastFrame, stdin } = renderTest(
      <REPL deps={createDepsWithBypassAvailable()} />,
    )

    // default → acceptEdits → plan → bypassPermissions
    sendShiftTab(stdin)
    await new Promise(r => setTimeout(r, TICK))
    expect(lastFrame()!).toContain('Accept edits')

    sendShiftTab(stdin)
    await new Promise(r => setTimeout(r, TICK))
    expect(lastFrame()!).toContain('Plan mode')

    sendShiftTab(stdin)
    await new Promise(r => setTimeout(r, TICK))
    expect(lastFrame()!).toContain('Bypass permissions')

    // bypassPermissions → default
    sendShiftTab(stdin)
    await new Promise(r => setTimeout(r, TICK))
    expect(lastFrame()!).not.toContain('Bypass permissions')
    expect(lastFrame()!).not.toContain('shift+tab to cycle')
  })
})
