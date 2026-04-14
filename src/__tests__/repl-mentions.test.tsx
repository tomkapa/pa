import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTest } from '../testing/render.js'
import { REPL, type REPLDeps } from '../repl.js'
import type { QueryDeps, CallModelParams } from '../services/agent/types.js'
import type { ToolBatchEvent } from '../services/tools/execution/types.js'
import type { QueryEvent } from '../types/streamEvents.js'
import type { Tool } from '../services/tools/types.js'
import { initializeToolPermissionContext } from '../services/permissions/initialize.js'
import { AgentRegistry } from '../services/agents/registry.js'
import { makeAssistantMessage } from '../testing/make-assistant-message.js'
import { buildTool } from '../services/tools/build-tool.js'
import { readToolDef } from '../tools/readTool.js'
import { FileStateCache } from '../utils/fileStateCache.js'

// ---------------------------------------------------------------------------
// End-to-end REPL test for @-file mentions.
//
// Verifies that when the user submits `review @foo.ts`, the REPL synthesizes
// a Read tool_use + tool_result pair ahead of the literal user text before
// handing the message array to the model.
// ---------------------------------------------------------------------------

const TICK = 100

interface CapturedCall {
  messages: CallModelParams['messages']
}

function createCapturingDeps(
  { withReadTool = false }: { withReadTool?: boolean } = {},
): { deps: REPLDeps; calls: CapturedCall[] } {
  const calls: CapturedCall[] = []
  const tools: Tool<unknown, unknown>[] = withReadTool
    ? [buildTool(readToolDef(new FileStateCache()))]
    : []

  const deps: REPLDeps = {
    tools,
    agentRegistry: new AgentRegistry(),
    initialPermissionContext: initializeToolPermissionContext().context,
    createQueryDeps: (): QueryDeps => ({
      async *callModel(params: CallModelParams): AsyncGenerator<QueryEvent> {
        calls.push({ messages: params.messages })
        yield makeAssistantMessage('OK')
      },
      async *executeToolBatch(): AsyncGenerator<ToolBatchEvent> {},
      uuid: () => crypto.randomUUID(),
    }),
  }
  return { deps, calls }
}

describe('REPL @-file mentions', () => {
  let originalCwd: string
  let tmpRoot: string

  beforeEach(async () => {
    originalCwd = process.cwd()
    tmpRoot = await mkdtemp(join(tmpdir(), 'repl-mentions-test-'))
    process.chdir(tmpRoot)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(tmpRoot, { recursive: true, force: true })
  })

  test('synthesizes Read tool_use + tool_result before the user text', async () => {
    await writeFile(join(tmpRoot, 'foo.ts'), 'export const x = 1')

    const { deps, calls } = createCapturingDeps()
    const { stdin } = renderTest(<REPL deps={deps} />)

    stdin.write('review @foo.ts please')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK * 3))

    expect(calls.length).toBe(1)
    const messages = calls[0]!.messages
    // Expect: 1 assistant (tool_use) + 1 merged user (tool_result + user text)
    // Normalizer merges consecutive user messages, so the tool_result and
    // the plain user text become a single user message with two content blocks.
    expect(messages.length).toBe(2)

    const asst = messages[0]!
    expect(asst.role).toBe('assistant')
    expect(Array.isArray(asst.content)).toBe(true)
    const asstBlocks = asst.content as Array<{ type: string; name?: string; input?: unknown }>
    expect(asstBlocks[0]!.type).toBe('tool_use')
    expect(asstBlocks[0]!.name).toBe('Read')
    const input = asstBlocks[0]!.input as { file_path: string }
    expect(input.file_path).toBe('foo.ts')

    const user = messages[1]!
    expect(user.role).toBe('user')
    const userBlocks = user.content as Array<{ type: string; content?: string; text?: string }>
    expect(userBlocks[0]!.type).toBe('tool_result')
    expect(userBlocks[0]!.content).toContain('export const x = 1')
    expect(userBlocks[1]!.type).toBe('text')
    expect(userBlocks[1]!.text).toBe('review @foo.ts please')
  })

  test('prompts without mentions pass through unchanged', async () => {
    const { deps, calls } = createCapturingDeps()
    const { stdin } = renderTest(<REPL deps={deps} />)

    stdin.write('hello world')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK * 3))

    expect(calls.length).toBe(1)
    const messages = calls[0]!.messages
    expect(messages.length).toBe(1)
    expect(messages[0]!.role).toBe('user')
    const blocks = messages[0]!.content as Array<{ type: string; text?: string }>
    expect(blocks[0]!.type).toBe('text')
    expect(blocks[0]!.text).toBe('hello world')
  })

  test('Enter while picker is open inserts selected path and does NOT submit', async () => {
    await writeFile(join(tmpRoot, 'foo.ts'), 'export const x = 1')

    const { deps, calls } = createCapturingDeps()
    const { stdin, lastFrame } = renderTest(<REPL deps={deps} />)

    // Type `@` — picker should open (foo.ts is the only candidate)
    stdin.write('@')
    await new Promise(r => setTimeout(r, TICK * 2))

    // Picker open, file visible in the frame
    expect(lastFrame()!).toContain('foo.ts')

    // Enter: this must pick foo.ts, NOT submit
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK))

    // No model call yet
    expect(calls.length).toBe(0)

    // Now submit for real with the inserted path
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK * 3))

    expect(calls.length).toBe(1)
    const messages = calls[0]!.messages
    // A tool_use for foo.ts was synthesized
    const asst = messages[0]!
    const asstBlocks = asst.content as Array<{ type: string; name?: string; input?: unknown }>
    expect(asstBlocks[0]!.type).toBe('tool_use')
    expect(asstBlocks[0]!.name).toBe('Read')
    expect((asstBlocks[0]!.input as { file_path: string }).file_path).toBe('foo.ts')
  })

  test('Esc dismisses the picker and leaves the text untouched', async () => {
    await writeFile(join(tmpRoot, 'foo.ts'), 'x')

    const { deps, calls } = createCapturingDeps()
    const { stdin, lastFrame } = renderTest(<REPL deps={deps} />)

    stdin.write('@')
    await new Promise(r => setTimeout(r, TICK * 2))
    expect(lastFrame()!).toContain('foo.ts')

    // Esc: dismiss the picker
    stdin.write('\x1b')
    await new Promise(r => setTimeout(r, TICK))

    // Submit — the literal `@` is still in the prompt but no mention was resolved
    // since the user never picked anything. The raw `@` doesn't match the
    // whitespace-anchored regex with an empty token, so no attachment is created.
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK * 3))

    expect(calls.length).toBe(1)
    const messages = calls[0]!.messages
    expect(messages.length).toBe(1)
    const blocks = messages[0]!.content as Array<{ type: string; text?: string }>
    expect(blocks[0]!.text).toBe('@')
  })

  test('real Read tool renders the synthesized tool_result without crashing', async () => {
    // Regression: the UI layer calls readToolUI.renderToolResultMessage with
    // the UserMessage.toolUseResult. If the builder forgets to populate it,
    // the renderer crashes on `output.content`.
    await writeFile(join(tmpRoot, 'foo.ts'), 'export const x = 1\nexport const y = 2')

    const { deps } = createCapturingDeps({ withReadTool: true })
    const { stdin, lastFrame } = renderTest(<REPL deps={deps} />)

    // Trailing space closes the mention token so Enter submits instead of
    // being intercepted by the picker.
    stdin.write('explain @foo.ts ')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK * 3))

    // The Read tool's renderToolResultMessage shows "Read N lines" in non-verbose.
    const frame = lastFrame()!
    expect(frame).toContain('Read')
    expect(frame).toContain('lines')
  })

  test('missing file produces an error tool_result, not a silent drop', async () => {
    const { deps, calls } = createCapturingDeps()
    const { stdin } = renderTest(<REPL deps={deps} />)

    stdin.write('check @nope.ts')
    await new Promise(r => setTimeout(r, TICK))
    stdin.write('\r')
    await new Promise(r => setTimeout(r, TICK * 3))

    expect(calls.length).toBe(1)
    const messages = calls[0]!.messages
    expect(messages.length).toBe(2)

    const user = messages[1]!
    const blocks = user.content as Array<{ type: string; content?: string; is_error?: boolean }>
    expect(blocks[0]!.type).toBe('tool_result')
    expect(blocks[0]!.content).toContain('nope.ts')
    expect(blocks[0]!.is_error).toBe(true)
  })
})
