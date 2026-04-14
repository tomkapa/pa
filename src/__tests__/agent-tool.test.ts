import { describe, test, expect } from 'bun:test'
import type { ContentBlock, StopReason } from '@anthropic-ai/sdk/resources/messages/messages'
import type { AssistantMessage } from '../types/message.js'
import type { QueryEvent } from '../types/streamEvents.js'
import type { CallModelParams } from '../services/agent/types.js'
import { buildTool } from '../services/tools/build-tool.js'
import {
  agentToolDef,
  filterToolsForChild,
  CHILD_SYSTEM_PROMPT,
  CHILD_DISALLOWED_TOOLS,
} from '../tools/agentTool.js'
import { AgentRegistry } from '../services/agents/registry.js'
import type { BuiltInAgentDefinition, CustomAgentDefinition } from '../services/agents/types.js'
import { makeContext } from '../testing/make-context.js'
import { makeFakeTool } from '../testing/make-tool-def.js'

// ─── Helpers ────────────────────────────────────────────────────────────

function createAssistantMsg(
  content: ContentBlock[],
  stopReason: StopReason = 'end_turn',
): AssistantMessage {
  return {
    type: 'assistant',
    uuid: `asst-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    requestId: 'req-test',
    message: {
      id: `msg-${crypto.randomUUID()}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content,
      stop_reason: stopReason,
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
  }
}

function textBlock(text: string): ContentBlock {
  return { type: 'text', text, citations: null } as ContentBlock
}

function makeFakeChildDeps() {
  return {
    callModel: async function* (): AsyncGenerator<QueryEvent> {
      yield createAssistantMsg([textBlock('done')])
    },
    executeToolBatch: async function* () {},
    uuid: () => crypto.randomUUID(),
  }
}

function makeNoOpChildDeps() {
  return {
    callModel: async function* () {},
    executeToolBatch: async function* () {},
    uuid: () => crypto.randomUUID(),
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('AgentTool', () => {
  // ── filterToolsForChild ──────────────────────────────────────────

  describe('filterToolsForChild', () => {
    test('removes Agent, EnterPlanMode, ExitPlanMode from tool list', () => {
      const tools = [
        makeFakeTool('Read'),
        makeFakeTool('Agent'),
        makeFakeTool('EnterPlanMode'),
        makeFakeTool('ExitPlanMode'),
        makeFakeTool('Bash'),
      ]
      const filtered = filterToolsForChild(tools)
      const names = filtered.map(t => t.name)
      expect(names).toEqual(['Read', 'Bash'])
    })

    test('returns all tools when none are disallowed', () => {
      const tools = [makeFakeTool('Read'), makeFakeTool('Grep')]
      const filtered = filterToolsForChild(tools)
      expect(filtered).toHaveLength(2)
    })

    test('returns empty array when all tools are disallowed', () => {
      const tools = [makeFakeTool('Agent'), makeFakeTool('EnterPlanMode')]
      const filtered = filterToolsForChild(tools)
      expect(filtered).toHaveLength(0)
    })
  })

  // ── CHILD_SYSTEM_PROMPT ──────────────────────────────────────────

  describe('CHILD_SYSTEM_PROMPT', () => {
    test('is a non-empty string', () => {
      expect(CHILD_SYSTEM_PROMPT).toBeString()
      expect(CHILD_SYSTEM_PROMPT.length).toBeGreaterThan(0)
    })

    test('mentions sub-agent role', () => {
      expect(CHILD_SYSTEM_PROMPT.toLowerCase()).toContain('sub-agent')
    })

    test('instructs concise output', () => {
      expect(CHILD_SYSTEM_PROMPT.toLowerCase()).toContain('concise')
    })
  })

  // ── CHILD_DISALLOWED_TOOLS ───────────────────────────────────────

  describe('CHILD_DISALLOWED_TOOLS', () => {
    test('includes Agent to prevent recursion', () => {
      expect(CHILD_DISALLOWED_TOOLS.has('Agent')).toBe(true)
    })

    test('includes plan mode tools', () => {
      expect(CHILD_DISALLOWED_TOOLS.has('EnterPlanMode')).toBe(true)
      expect(CHILD_DISALLOWED_TOOLS.has('ExitPlanMode')).toBe(true)
    })
  })

  // ── Tool metadata ────────────────────────────────────────────────

  describe('tool metadata', () => {
    const tool = buildTool(agentToolDef({
      createChildQueryDeps: () => makeNoOpChildDeps(),
      tools: [],
    }))

    test('has name "Agent"', () => {
      expect(tool.name).toBe('Agent')
    })

    test('is not read-only', () => {
      expect(tool.isReadOnly({ prompt: 'x', description: 'y' })).toBe(false)
    })

    test('is not concurrency-safe', () => {
      expect(tool.isConcurrencySafe({ prompt: 'x', description: 'y' })).toBe(false)
    })

    test('validates prompt is a string', () => {
      const result = tool.inputSchema.safeParse({ prompt: 'do something', description: 'test' })
      expect(result.success).toBe(true)
    })

    test('rejects missing prompt', () => {
      const result = tool.inputSchema.safeParse({ description: 'test' })
      expect(result.success).toBe(false)
    })

    test('rejects missing description', () => {
      const result = tool.inputSchema.safeParse({ prompt: 'do something' })
      expect(result.success).toBe(false)
    })
  })

  // ── Subagent execution ───────────────────────────────────────────

  describe('subagent execution', () => {
    test('runs child query loop and returns final assistant text', async () => {
      const finalResponse = createAssistantMsg([textBlock('Here is the summary.')])

      const tool = buildTool(agentToolDef({
        createChildQueryDeps: () => ({
          callModel: async function* (): AsyncGenerator<QueryEvent> {
            yield finalResponse
          },
          executeToolBatch: async function* () {},
          uuid: () => crypto.randomUUID(),
        }),
        tools: [],
      }))

      const ctx = makeContext()
      const result = await tool.call(
        { prompt: 'Search the codebase for X', description: 'Search codebase' },
        ctx,
      )

      expect(result.data.status).toBe('completed')
      expect(result.data.content).toBe('Here is the summary.')
      expect(result.data.totalDurationMs).toBeGreaterThanOrEqual(0)
    })

    test('returns error when child produces no assistant message', async () => {
      const tool = buildTool(agentToolDef({
        createChildQueryDeps: () => ({
          callModel: async function* (): AsyncGenerator<QueryEvent> {},
          executeToolBatch: async function* () {},
          uuid: () => crypto.randomUUID(),
        }),
        tools: [],
      }))

      const ctx = makeContext()
      const result = await tool.call(
        { prompt: 'do something', description: 'test' },
        ctx,
      )

      expect(result.data.status).toBe('error')
      expect(result.data.content).toContain('Sub-agent error')
    })

    test('extracts text from multi-block assistant response', async () => {
      const finalResponse = createAssistantMsg([
        textBlock('Part one. '),
        textBlock('Part two.'),
      ])

      const tool = buildTool(agentToolDef({
        createChildQueryDeps: () => ({
          callModel: async function* (): AsyncGenerator<QueryEvent> {
            yield finalResponse
          },
          executeToolBatch: async function* () {},
          uuid: () => crypto.randomUUID(),
        }),
        tools: [],
      }))

      const ctx = makeContext()
      const result = await tool.call(
        { prompt: 'analyze', description: 'Analyze code' },
        ctx,
      )

      expect(result.data.content).toBe('Part one. Part two.')
    })

    test('child uses filtered tools (no Agent in child)', async () => {
      let childToolNames: string[] = []

      const tool = buildTool(agentToolDef({
        createChildQueryDeps: (opts) => {
          childToolNames = opts.tools.map(t => t.name)
          return makeFakeChildDeps()
        },
        tools: [makeFakeTool('Read'), makeFakeTool('Agent'), makeFakeTool('Bash')],
      }))

      const ctx = makeContext()
      await tool.call(
        { prompt: 'test', description: 'test' },
        ctx,
      )

      expect(childToolNames).toContain('Read')
      expect(childToolNames).toContain('Bash')
      expect(childToolNames).not.toContain('Agent')
    })
  })

  // ── Abort linking ────────────────────────────────────────────────

  describe('abort linking', () => {
    test('child aborts when parent aborts', async () => {
      let childAbortSignal: AbortSignal | undefined

      const parentAbort = new AbortController()

      const tool = buildTool(agentToolDef({
        createChildQueryDeps: () => ({
          callModel: async function* (params: CallModelParams): AsyncGenerator<QueryEvent> {
            childAbortSignal = params.abortSignal
            parentAbort.abort()
            yield createAssistantMsg([textBlock('done')])
          },
          executeToolBatch: async function* () {},
          uuid: () => crypto.randomUUID(),
        }),
        tools: [],
      }))

      const ctx = makeContext({ abortController: parentAbort })
      await tool.call(
        { prompt: 'test', description: 'test' },
        ctx,
      )

      expect(childAbortSignal).toBeDefined()
      expect(childAbortSignal!.aborted).toBe(true)
    })

    test('parent abort after cleanup does not propagate to child', async () => {
      let childAbortController: AbortController | undefined

      const parentAbort = new AbortController()

      const tool = buildTool(agentToolDef({
        createChildQueryDeps: (opts) => {
          childAbortController = opts.abortController
          return makeFakeChildDeps()
        },
        tools: [],
      }))

      const ctx = makeContext({ abortController: parentAbort })
      await tool.call(
        { prompt: 'test', description: 'test' },
        ctx,
      )

      // After the call completes, the listener should be cleaned up.
      // Aborting the parent now should NOT forward to the child.
      parentAbort.abort()
      expect(childAbortController!.signal.aborted).toBe(false)
    })
  })

  // ── System prompt ────────────────────────────────────────────────

  describe('child system prompt', () => {
    test('passes child system prompt to query loop', async () => {
      let receivedSystemPrompt: string[] = []

      const tool = buildTool(agentToolDef({
        createChildQueryDeps: () => ({
          callModel: async function* (params: CallModelParams): AsyncGenerator<QueryEvent> {
            receivedSystemPrompt = params.systemPrompt
            yield createAssistantMsg([textBlock('done')])
          },
          executeToolBatch: async function* () {},
          uuid: () => crypto.randomUUID(),
        }),
        tools: [],
      }))

      const ctx = makeContext()
      await tool.call(
        { prompt: 'test', description: 'Search code' },
        ctx,
      )

      expect(receivedSystemPrompt.length).toBeGreaterThan(0)
      expect(receivedSystemPrompt[0]!.toLowerCase()).toContain('sub-agent')
    })
  })

  // ── Result serialization ─────────────────────────────────────────

  describe('mapToolResultToToolResultBlockParam', () => {
    const tool = buildTool(agentToolDef({
      createChildQueryDeps: () => makeNoOpChildDeps(),
      tools: [],
    }))

    test('serializes completed result', () => {
      const output = {
        status: 'completed' as const,
        content: 'Found 3 files.',
        totalDurationMs: 1500,
      }
      const result = tool.mapToolResultToToolResultBlockParam(output, 'tu-123')
      expect(result.type).toBe('tool_result')
      expect(result.tool_use_id).toBe('tu-123')
      expect(typeof result.content).toBe('string')
      expect(result.content).toContain('Found 3 files.')
    })
  })

  // ── subagent_type resolution ────────────────────────────────────

  describe('subagent_type', () => {
    test('accepts optional subagent_type in input schema', () => {
      const tool = buildTool(agentToolDef({
        createChildQueryDeps: () => makeNoOpChildDeps(),
        tools: [],
      }))
      const result = tool.inputSchema.safeParse({
        prompt: 'test',
        description: 'test',
        subagent_type: 'code-reviewer',
      })
      expect(result.success).toBe(true)
    })

    test('subagent_type is optional — omitting it works', () => {
      const tool = buildTool(agentToolDef({
        createChildQueryDeps: () => makeNoOpChildDeps(),
        tools: [],
      }))
      const result = tool.inputSchema.safeParse({
        prompt: 'test',
        description: 'test',
      })
      expect(result.success).toBe(true)
    })

    test('uses agent definition system prompt when subagent_type matches', async () => {
      let receivedSystemPrompt: string[] = []

      const registry = new AgentRegistry()
      registry.register({
        agentType: 'code-reviewer',
        whenToUse: 'Reviews code',
        tools: undefined,
        getSystemPrompt: () => 'You are a code review specialist.',
        source: 'built-in',
      } satisfies BuiltInAgentDefinition)

      const tool = buildTool(agentToolDef({
        createChildQueryDeps: () => ({
          callModel: async function* (params: CallModelParams): AsyncGenerator<QueryEvent> {
            receivedSystemPrompt = params.systemPrompt
            yield createAssistantMsg([textBlock('reviewed')])
          },
          executeToolBatch: async function* () {},
          uuid: () => crypto.randomUUID(),
        }),
        tools: [makeFakeTool('Read'), makeFakeTool('Grep')],
        agentRegistry: registry,
      }))

      const ctx = makeContext()
      await tool.call(
        { prompt: 'review this', description: 'Code review', subagent_type: 'code-reviewer' },
        ctx,
      )

      expect(receivedSystemPrompt[0]).toBe('You are a code review specialist.')
    })

    test('uses default system prompt when subagent_type does not match', async () => {
      let receivedSystemPrompt: string[] = []

      const registry = new AgentRegistry()

      const tool = buildTool(agentToolDef({
        createChildQueryDeps: () => ({
          callModel: async function* (params: CallModelParams): AsyncGenerator<QueryEvent> {
            receivedSystemPrompt = params.systemPrompt
            yield createAssistantMsg([textBlock('done')])
          },
          executeToolBatch: async function* () {},
          uuid: () => crypto.randomUUID(),
        }),
        tools: [],
        agentRegistry: registry,
      }))

      const ctx = makeContext()
      await tool.call(
        { prompt: 'test', description: 'test', subagent_type: 'nonexistent' },
        ctx,
      )

      expect(receivedSystemPrompt[0]!.toLowerCase()).toContain('sub-agent')
    })

    test('applies tool allowlist from agent definition', async () => {
      let childToolNames: string[] = []

      const registry = new AgentRegistry()
      registry.register({
        agentType: 'reader',
        whenToUse: 'Read only',
        tools: ['Read', 'Grep'],
        getSystemPrompt: () => 'Read-only agent.',
        source: 'built-in',
      } satisfies BuiltInAgentDefinition)

      const tool = buildTool(agentToolDef({
        createChildQueryDeps: (opts) => {
          childToolNames = opts.tools.map(t => t.name)
          return makeFakeChildDeps()
        },
        tools: [makeFakeTool('Read'), makeFakeTool('Grep'), makeFakeTool('Bash'), makeFakeTool('Write')],
        agentRegistry: registry,
      }))

      const ctx = makeContext()
      await tool.call(
        { prompt: 'read', description: 'Read files', subagent_type: 'reader' },
        ctx,
      )

      expect(childToolNames).toEqual(['Read', 'Grep'])
    })

    test('applies tool blocklist from agent definition', async () => {
      let childToolNames: string[] = []

      const registry = new AgentRegistry()
      registry.register({
        agentType: 'safe-agent',
        whenToUse: 'No bash',
        disallowedTools: ['Bash'],
        getSystemPrompt: () => 'Safe agent.',
        source: 'built-in',
      } satisfies BuiltInAgentDefinition)

      const tool = buildTool(agentToolDef({
        createChildQueryDeps: (opts) => {
          childToolNames = opts.tools.map(t => t.name)
          return makeFakeChildDeps()
        },
        tools: [makeFakeTool('Read'), makeFakeTool('Bash'), makeFakeTool('Write')],
        agentRegistry: registry,
      }))

      const ctx = makeContext()
      await tool.call(
        { prompt: 'work', description: 'Work safely', subagent_type: 'safe-agent' },
        ctx,
      )

      expect(childToolNames).toContain('Read')
      expect(childToolNames).toContain('Write')
      expect(childToolNames).not.toContain('Bash')
    })

    test('custom agent overrides built-in with same name', async () => {
      let receivedSystemPrompt: string[] = []

      const registry = new AgentRegistry()
      registry.registerBuiltIns([{
        agentType: 'Explore',
        whenToUse: 'Built-in explore',
        getSystemPrompt: () => 'Built-in explore prompt.',
        source: 'built-in',
      }])
      registry.registerCustom([{
        agentType: 'Explore',
        whenToUse: 'Custom explore',
        getSystemPrompt: () => 'Custom explore prompt.',
        source: 'project',
        filename: 'explore',
      }])

      const tool = buildTool(agentToolDef({
        createChildQueryDeps: () => ({
          callModel: async function* (params: CallModelParams): AsyncGenerator<QueryEvent> {
            receivedSystemPrompt = params.systemPrompt
            yield createAssistantMsg([textBlock('explored')])
          },
          executeToolBatch: async function* () {},
          uuid: () => crypto.randomUUID(),
        }),
        tools: [],
        agentRegistry: registry,
      }))

      const ctx = makeContext()
      await tool.call(
        { prompt: 'explore', description: 'Explore', subagent_type: 'Explore' },
        ctx,
      )

      expect(receivedSystemPrompt[0]).toBe('Custom explore prompt.')
    })

    test('works without agentRegistry (backward compatibility)', async () => {
      let receivedSystemPrompt: string[] = []

      const tool = buildTool(agentToolDef({
        createChildQueryDeps: () => ({
          callModel: async function* (params: CallModelParams): AsyncGenerator<QueryEvent> {
            receivedSystemPrompt = params.systemPrompt
            yield createAssistantMsg([textBlock('done')])
          },
          executeToolBatch: async function* () {},
          uuid: () => crypto.randomUUID(),
        }),
        tools: [],
        // No agentRegistry
      }))

      const ctx = makeContext()
      await tool.call(
        { prompt: 'test', description: 'test', subagent_type: 'anything' },
        ctx,
      )

      // Falls back to default prompt
      expect(receivedSystemPrompt[0]!.toLowerCase()).toContain('sub-agent')
    })
  })
})
