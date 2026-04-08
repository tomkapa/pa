import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AssistantMessage, UserMessage } from '../types/message.js'
import { buildMessagesForUserTurn } from '../services/mentions/message-builder.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'msg-builder-test-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('buildMessagesForUserTurn', () => {
  test('returns single user message when prompt has no mentions', async () => {
    const result = await buildMessagesForUserTurn({
      promptText: 'hello world',
      cwd: root,
    })

    expect(result.length).toBe(1)
    const [user] = result
    expect(user!.type).toBe('user')
    expect((user as UserMessage).message.role).toBe('user')
    const content = (user as UserMessage).message.content
    expect(Array.isArray(content)).toBe(true)
    expect(content).toEqual([{ type: 'text', text: 'hello world' }])
  })

  test('synthesizes tool_use + tool_result for a mentioned file', async () => {
    await writeFile(join(root, 'foo.ts'), 'console.log("hi")')

    const result = await buildMessagesForUserTurn({
      promptText: 'review @foo.ts',
      cwd: root,
    })

    expect(result.length).toBe(3)

    const [asst, toolResult, user] = result
    expect(asst!.type).toBe('assistant')
    const asstContent = (asst as AssistantMessage).message.content
    expect(asstContent.length).toBe(1)
    expect(asstContent[0]!.type).toBe('tool_use')
    const toolUse = asstContent[0] as { id: string; name: string; input: { file_path: string } }
    expect(toolUse.name).toBe('Read')
    expect(toolUse.input.file_path).toBe('foo.ts')

    expect(toolResult!.type).toBe('user')
    const toolResultUser = toolResult as UserMessage
    expect(toolResultUser.isMeta).toBe(true)
    expect(toolResultUser.toolName).toBe('Read')
    // toolUseResult is what the UI renders — it must match ReadToolOutput shape.
    const toolUseResult = toolResultUser.toolUseResult as {
      type: string
      content: string
      numLines: number
      startLine: number
      totalLines: number
    }
    expect(toolUseResult.type).toBe('text')
    expect(toolUseResult.content).toContain('console.log')
    expect(toolUseResult.numLines).toBe(1)
    expect(toolUseResult.totalLines).toBe(1)
    expect(toolUseResult.startLine).toBe(1)

    const trContent = toolResultUser.message.content as Array<{
      type: string
      tool_use_id: string
      content: string
    }>
    expect(trContent[0]!.type).toBe('tool_result')
    expect(trContent[0]!.tool_use_id).toBe(toolUse.id)
    expect(trContent[0]!.content).toContain('console.log')

    expect(user!.type).toBe('user')
    expect((user as UserMessage).isMeta).toBeUndefined()
    expect((user as UserMessage).message.content).toEqual([
      { type: 'text', text: 'review @foo.ts' },
    ])
  })

  test('handles multiple mentions with interleaved tool_use/tool_result pairs', async () => {
    await writeFile(join(root, 'a.ts'), 'AAA')
    await writeFile(join(root, 'b.ts'), 'BBB')

    const result = await buildMessagesForUserTurn({
      promptText: 'diff @a.ts and @b.ts',
      cwd: root,
    })

    // 2 pairs + 1 user message = 5
    expect(result.length).toBe(5)
    expect(result[0]!.type).toBe('assistant')
    expect(result[1]!.type).toBe('user')
    expect((result[1] as UserMessage).isMeta).toBe(true)
    expect(result[2]!.type).toBe('assistant')
    expect(result[3]!.type).toBe('user')
    expect((result[3] as UserMessage).isMeta).toBe(true)
    expect(result[4]!.type).toBe('user')
    expect((result[4] as UserMessage).isMeta).toBeUndefined()

    // Check id pairing
    const use1 = (result[0] as AssistantMessage).message.content[0] as { id: string }
    const res1 = ((result[1] as UserMessage).message.content as Array<{ tool_use_id: string }>)[0]!
    expect(res1.tool_use_id).toBe(use1.id)

    const use2 = (result[2] as AssistantMessage).message.content[0] as { id: string }
    const res2 = ((result[3] as UserMessage).message.content as Array<{ tool_use_id: string }>)[0]!
    expect(res2.tool_use_id).toBe(use2.id)
  })

  test('attaches an error tool_result for a missing file', async () => {
    const result = await buildMessagesForUserTurn({
      promptText: 'check @does-not-exist.ts',
      cwd: root,
    })

    expect(result.length).toBe(3)
    const toolResult = result[1] as UserMessage
    const content = toolResult.message.content as Array<{
      type: string
      content: string
      is_error?: boolean
    }>
    expect(content[0]!.type).toBe('tool_result')
    expect(content[0]!.content).toContain('does-not-exist.ts')
    // Mark errors so the REPL can render them differently if it wants.
    expect(content[0]!.is_error).toBe(true)
  })

  test('annotates truncation in the tool_result', async () => {
    const bigPath = join(root, 'big.ts')
    const lines = Array.from({ length: 3000 }, (_, i) => `line${i}`)
    await writeFile(bigPath, lines.join('\n'))

    const result = await buildMessagesForUserTurn({
      promptText: '@big.ts',
      cwd: root,
      maxLines: 100,
    })

    const toolResult = result[1] as UserMessage
    const content = toolResult.message.content as Array<{ content: string }>
    expect(content[0]!.content).toContain('truncated')
  })

  test('email addresses do not produce attachments', async () => {
    const result = await buildMessagesForUserTurn({
      promptText: 'ping alice@example.com please',
      cwd: root,
    })
    expect(result.length).toBe(1)
  })

  test('prompt text is preserved verbatim even with mentions', async () => {
    await writeFile(join(root, 'x.ts'), 'X')
    const result = await buildMessagesForUserTurn({
      promptText: 'Please review @x.ts carefully.',
      cwd: root,
    })
    const user = result.at(-1) as UserMessage
    expect(user.message.content).toEqual([
      { type: 'text', text: 'Please review @x.ts carefully.' },
    ])
  })
})
