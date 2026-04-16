import { describe, expect, test } from 'bun:test'
import { lspToolDef, type LspToolInput, type LspToolOutput } from '../tools/lspTool.js'
import { buildTool } from '../services/tools/index.js'
import { makeContext } from '../testing/make-context.js'

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('LSP tool — schema', () => {
  test('accepts valid input', () => {
    const def = lspToolDef()
    const result = def.inputSchema.safeParse({
      operation: 'goToDefinition',
      filePath: 'src/main.ts',
      line: 42,
      character: 5,
    })
    expect(result.success).toBe(true)
  })

  test('requires all fields', () => {
    const def = lspToolDef()
    expect(def.inputSchema.safeParse({}).success).toBe(false)
    expect(def.inputSchema.safeParse({ operation: 'hover' }).success).toBe(false)
    expect(
      def.inputSchema.safeParse({ operation: 'hover', filePath: 'x.ts' }).success,
    ).toBe(false)
  })

  test('rejects unknown keys (strictObject)', () => {
    const def = lspToolDef()
    expect(
      def.inputSchema.safeParse({
        operation: 'hover',
        filePath: 'x.ts',
        line: 1,
        character: 1,
        extra: true,
      }).success,
    ).toBe(false)
  })

  test('rejects invalid operation', () => {
    const def = lspToolDef()
    expect(
      def.inputSchema.safeParse({
        operation: 'invalidOp',
        filePath: 'x.ts',
        line: 1,
        character: 1,
      }).success,
    ).toBe(false)
  })

  test('coerces string numbers (semanticNumber)', () => {
    const def = lspToolDef()
    const result = def.inputSchema.safeParse({
      operation: 'hover',
      filePath: 'x.ts',
      line: '42',
      character: '5',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.line).toBe(42)
      expect(result.data.character).toBe(5)
    }
  })

  test('rejects zero or negative line/character', () => {
    const def = lspToolDef()
    expect(
      def.inputSchema.safeParse({
        operation: 'hover',
        filePath: 'x.ts',
        line: 0,
        character: 1,
      }).success,
    ).toBe(false)
    expect(
      def.inputSchema.safeParse({
        operation: 'hover',
        filePath: 'x.ts',
        line: 1,
        character: -1,
      }).success,
    ).toBe(false)
  })

  test('accepts all three operations', () => {
    const def = lspToolDef()
    for (const op of ['goToDefinition', 'findReferences', 'hover'] as const) {
      expect(
        def.inputSchema.safeParse({
          operation: op,
          filePath: 'x.ts',
          line: 1,
          character: 1,
        }).success,
      ).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

describe('LSP tool — metadata', () => {
  test('is named LSP', () => {
    const tool = buildTool(lspToolDef())
    expect(tool.name).toBe('LSP')
  })

  test('is read-only', () => {
    const tool = buildTool(lspToolDef())
    const input: LspToolInput = {
      operation: 'hover',
      filePath: 'x.ts',
      line: 1,
      character: 1,
    }
    expect(tool.isReadOnly(input)).toBe(true)
  })

  test('is concurrency-safe', () => {
    const tool = buildTool(lspToolDef())
    const input: LspToolInput = {
      operation: 'hover',
      filePath: 'x.ts',
      line: 1,
      character: 1,
    }
    expect(tool.isConcurrencySafe(input)).toBe(true)
  })

  test('is deferred', () => {
    const tool = buildTool(lspToolDef())
    expect(tool.shouldDefer).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Result serialization
// ---------------------------------------------------------------------------

describe('LSP tool — result serialization', () => {
  test('formats result as tool_result block', () => {
    const tool = buildTool(lspToolDef())
    const output: LspToolOutput = {
      type: 'lsp_result',
      operation: 'goToDefinition',
      result: 'Defined in src/utils.ts:42:5',
    }

    const block = tool.mapToolResultToToolResultBlockParam(output, 'tool-123')
    expect(block.type).toBe('tool_result')
    expect(block.tool_use_id).toBe('tool-123')
    expect(block.content).toBe('Defined in src/utils.ts:42:5')
  })
})

// ---------------------------------------------------------------------------
// Unsupported file types (no server needed)
// ---------------------------------------------------------------------------

describe('LSP tool — unsupported files', () => {
  test('returns informative message for non-TS files', async () => {
    const tool = buildTool(lspToolDef())
    const result = await tool.call(
      {
        operation: 'goToDefinition',
        filePath: '/tmp/test.py',
        line: 1,
        character: 1,
      },
      makeContext(),
    )

    expect(result.data.operation).toBe('goToDefinition')
    expect(result.data.result).toContain('No LSP server available for file type: .py')
  })

  test('handles files without extension', async () => {
    const tool = buildTool(lspToolDef())
    const result = await tool.call(
      {
        operation: 'hover',
        filePath: '/tmp/Makefile',
        line: 1,
        character: 1,
      },
      makeContext(),
    )

    expect(result.data.result).toContain('No LSP server available for file type')
  })
})

// ---------------------------------------------------------------------------
// Description / prompt
// ---------------------------------------------------------------------------

describe('LSP tool — description', () => {
  test('description includes operation and file', async () => {
    const def = lspToolDef()
    const desc = await def.description({
      operation: 'goToDefinition',
      filePath: 'src/main.ts',
      line: 42,
      character: 5,
    })
    expect(desc).toBe('LSP goToDefinition at src/main.ts:42:5')
  })

  test('prompt describes capabilities', async () => {
    const def = lspToolDef()
    const prompt = await def.prompt()
    expect(prompt).toContain('goToDefinition')
    expect(prompt).toContain('findReferences')
    expect(prompt).toContain('hover')
    expect(prompt).toContain('1-based')
  })
})
