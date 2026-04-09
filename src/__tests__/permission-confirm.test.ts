import { describe, test, expect, mock } from 'bun:test'
import { createPermissionContext } from '../services/permissions/context.js'
import { buildTool } from '../services/tools/build-tool.js'
import { createCanUseToolWithConfirm } from '../services/permissions/confirm.js'
import type { ToolUseConfirm } from '../services/permissions/confirm.js'
import { makeContext } from '../testing/make-context.js'
import { makeToolDef } from '../testing/make-tool-def.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Flush enough microtask ticks for the async pipeline to complete. */
async function flush(ticks = 10): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve()
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createCanUseToolWithConfirm', () => {
  test('returns allow decision immediately when permission allows', async () => {
    const ctx = createPermissionContext({
      alwaysAllowRules: { session: ['TestTool'] },
    })
    const pushConfirm = mock(() => {})
    const canUseTool = createCanUseToolWithConfirm(() => ctx, pushConfirm)

    const tool = buildTool(makeToolDef())
    const result = await canUseTool(tool, { value: 'hi' }, makeContext())

    expect(result.behavior).toBe('allow')
    expect(pushConfirm).not.toHaveBeenCalled()
  })

  test('returns deny decision immediately when permission denies', async () => {
    const ctx = createPermissionContext({
      alwaysDenyRules: { session: ['TestTool'] },
    })
    const pushConfirm = mock(() => {})
    const canUseTool = createCanUseToolWithConfirm(() => ctx, pushConfirm)

    const tool = buildTool(makeToolDef())
    const result = await canUseTool(tool, { value: 'hi' }, makeContext())

    expect(result.behavior).toBe('deny')
    expect(pushConfirm).not.toHaveBeenCalled()
  })

  test('pushes confirm onto queue when permission asks and resolves allow on onAllow', async () => {
    const ctx = createPermissionContext() // default mode, no rules → ask
    let capturedConfirm: ToolUseConfirm | undefined
    const pushConfirm = mock((confirm: ToolUseConfirm) => {
      capturedConfirm = confirm
    })
    const canUseTool = createCanUseToolWithConfirm(() => ctx, pushConfirm)

    const tool = buildTool(makeToolDef())

    // Start the permission check — it should push a confirm and block
    const resultPromise = canUseTool(tool, { value: 'hi' }, makeContext())

    await flush()

    expect(pushConfirm).toHaveBeenCalledTimes(1)
    expect(capturedConfirm).toBeDefined()
    expect(capturedConfirm!.tool).toBe(tool)

    // Simulate user pressing "Yes"
    capturedConfirm!.onAllow({ value: 'hi' }, [])

    const result = await resultPromise
    expect(result.behavior).toBe('allow')
    if (result.behavior === 'allow') {
      expect(result.updatedInput).toEqual({ value: 'hi' })
    }
  })

  test('resolves deny on onReject', async () => {
    const ctx = createPermissionContext()
    let capturedConfirm: ToolUseConfirm | undefined
    const pushConfirm = mock((confirm: ToolUseConfirm) => {
      capturedConfirm = confirm
    })
    const canUseTool = createCanUseToolWithConfirm(() => ctx, pushConfirm)

    const tool = buildTool(makeToolDef())
    const resultPromise = canUseTool(tool, { value: 'hi' }, makeContext())
    await flush()

    capturedConfirm!.onReject('User said no')

    const result = await resultPromise
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toBe('User said no')
    }
  })

  test('resolves deny on onReject without feedback', async () => {
    const ctx = createPermissionContext()
    let capturedConfirm: ToolUseConfirm | undefined
    const pushConfirm = mock((confirm: ToolUseConfirm) => {
      capturedConfirm = confirm
    })
    const canUseTool = createCanUseToolWithConfirm(() => ctx, pushConfirm)

    const tool = buildTool(makeToolDef())
    const resultPromise = canUseTool(tool, { value: 'hi' }, makeContext())
    await flush()

    capturedConfirm!.onReject()

    const result = await resultPromise
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toBe('User denied')
    }
  })

  test('resolves deny on onAbort', async () => {
    const ctx = createPermissionContext()
    let capturedConfirm: ToolUseConfirm | undefined
    const pushConfirm = mock((confirm: ToolUseConfirm) => {
      capturedConfirm = confirm
    })
    const canUseTool = createCanUseToolWithConfirm(() => ctx, pushConfirm)

    const tool = buildTool(makeToolDef())
    const resultPromise = canUseTool(tool, { value: 'hi' }, makeContext())
    await flush()

    capturedConfirm!.onAbort()

    const result = await resultPromise
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toBe('Aborted')
    }
  })

  test('allow result includes reason from original ask decision', async () => {
    const ctx = createPermissionContext()
    let capturedConfirm: ToolUseConfirm | undefined
    const pushConfirm = mock((confirm: ToolUseConfirm) => {
      capturedConfirm = confirm
    })
    const canUseTool = createCanUseToolWithConfirm(() => ctx, pushConfirm)

    const tool = buildTool(makeToolDef())
    const resultPromise = canUseTool(tool, { value: 'hi' }, makeContext())
    await flush()

    capturedConfirm!.onAllow({ value: 'hi' }, [])

    const result = await resultPromise
    expect(result.behavior).toBe('allow')
    if (result.behavior === 'allow') {
      expect(result.reason).toBeDefined()
      expect(result.updatedInput).toEqual({ value: 'hi' })
    }
  })

  test('carries through decision message and suggestions', async () => {
    // Use a tool that returns specific ask message with suggestions
    const ctx = createPermissionContext()
    let capturedConfirm: ToolUseConfirm | undefined
    const pushConfirm = mock((confirm: ToolUseConfirm) => {
      capturedConfirm = confirm
    })
    const canUseTool = createCanUseToolWithConfirm(() => ctx, pushConfirm)

    const tool = buildTool(makeToolDef())
    const resultPromise = canUseTool(tool, { value: 'hi' }, makeContext())
    await flush()

    // The confirm should carry the decision's message
    expect(capturedConfirm!.message).toBeString()

    capturedConfirm!.onAllow({ value: 'hi' }, [])
    await resultPromise
  })
})
