import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildEffectiveSystemPrompt,
  cachedSection,
  getSystemPrompt,
  resetSectionCache,
  uncachedSection,
} from '../services/system-prompt/index.js'
import { DYNAMIC_BOUNDARY } from '../services/system-prompt/types.js'

afterEach(() => resetSectionCache())

// ---------------------------------------------------------------------------
// getSystemPrompt
// ---------------------------------------------------------------------------

describe('getSystemPrompt', () => {
  test('always contains the dynamic boundary marker', async () => {
    const prompt = await getSystemPrompt({
      enabledTools: new Set(['Read']),
      modelId: 'claude-test',
      dynamicSections: [],
    })
    expect(prompt).toContain(DYNAMIC_BOUNDARY)
  })

  test('places static sections before the boundary', async () => {
    const prompt = await getSystemPrompt({
      enabledTools: new Set(['Read', 'Edit']),
      modelId: 'claude-test',
      dynamicSections: [],
    })
    const boundaryIdx = prompt.indexOf(DYNAMIC_BOUNDARY)
    expect(boundaryIdx).toBeGreaterThan(0)
    // Static sections should be present before the boundary
    const staticChunk = prompt.slice(0, boundaryIdx).join('\n\n')
    expect(staticChunk).toContain('# System')
    expect(staticChunk).toContain('# Tone')
  })

  test('places dynamic sections after the boundary', async () => {
    const prompt = await getSystemPrompt({
      enabledTools: new Set(['Read']),
      modelId: 'claude-test',
      dynamicSections: [
        cachedSection('hello', () => 'HELLO_DYNAMIC'),
      ],
    })
    const boundaryIdx = prompt.indexOf(DYNAMIC_BOUNDARY)
    const dynamicChunk = prompt.slice(boundaryIdx + 1).join('\n\n')
    expect(dynamicChunk).toContain('HELLO_DYNAMIC')
  })

  test('filters out sections that resolve to null', async () => {
    const prompt = await getSystemPrompt({
      enabledTools: new Set(['Read']),
      modelId: 'claude-test',
      dynamicSections: [
        cachedSection('null-out', () => null),
        cachedSection('present', () => 'present-value'),
      ],
    })
    expect(prompt).toContain('present-value')
    // Null sections should not leave behind any null entries
    expect(prompt.every(s => typeof s === 'string' && s.length > 0)).toBe(true)
  })

  test('disabling tools removes their guidance', async () => {
    const withRead = await getSystemPrompt({
      enabledTools: new Set(['Read']),
      modelId: 'claude-test',
      dynamicSections: [],
    })
    const withoutTools = await getSystemPrompt({
      enabledTools: new Set(),
      modelId: 'claude-test',
      dynamicSections: [],
    })
    const withReadJoined = withRead.join('\n\n')
    const withoutToolsJoined = withoutTools.join('\n\n')
    expect(withReadJoined).toContain('Read')
    // Without any tools enabled, the tool guidance section is omitted
    expect(withoutToolsJoined).not.toContain('# Using your tools')
  })

  test('uses the default registry when none is provided', async () => {
    const prompt = await getSystemPrompt({
      enabledTools: new Set(['Read']),
      modelId: 'claude-test',
      modelName: 'Claude Test Model',
    })
    const joined = prompt.join('\n\n')
    expect(joined).toContain('Claude Test Model')
  })

  test('uncached sections recompute on subsequent calls', async () => {
    let calls = 0
    const dynamicSections = [
      uncachedSection(
        'volatile',
        () => {
          calls++
          return `tick-${calls}`
        },
        'test - recomputes every turn',
      ),
    ]

    await getSystemPrompt({
      enabledTools: new Set(['Read']),
      modelId: 'claude-test',
      dynamicSections,
    })
    await getSystemPrompt({
      enabledTools: new Set(['Read']),
      modelId: 'claude-test',
      dynamicSections,
    })
    expect(calls).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// buildEffectiveSystemPrompt — priority selection
// ---------------------------------------------------------------------------

describe('buildEffectiveSystemPrompt', () => {
  const defaultPrompt = ['default-1', 'default-2']

  test('returns the default prompt when no overrides are present', () => {
    const result = buildEffectiveSystemPrompt({ defaultSystemPrompt: defaultPrompt })
    expect(result).toEqual(defaultPrompt)
  })

  test('returns a fresh copy (not the same array reference)', () => {
    const result = buildEffectiveSystemPrompt({ defaultSystemPrompt: defaultPrompt })
    expect(result).not.toBe(defaultPrompt)
  })

  test('appendSystemPrompt is concatenated at the end', () => {
    const result = buildEffectiveSystemPrompt({
      defaultSystemPrompt: defaultPrompt,
      appendSystemPrompt: 'extra-instructions',
    })
    expect(result).toEqual(['default-1', 'default-2', 'extra-instructions'])
  })

  test('customSystemPrompt replaces the default', () => {
    const result = buildEffectiveSystemPrompt({
      defaultSystemPrompt: defaultPrompt,
      customSystemPrompt: 'CUSTOM',
    })
    expect(result).toEqual(['CUSTOM'])
  })

  test('agentSystemPrompt wins over customSystemPrompt', () => {
    const result = buildEffectiveSystemPrompt({
      defaultSystemPrompt: defaultPrompt,
      customSystemPrompt: 'CUSTOM',
      agentSystemPrompt: 'AGENT',
    })
    expect(result).toEqual(['AGENT'])
  })

  test('overrideSystemPrompt wins over everything', () => {
    const result = buildEffectiveSystemPrompt({
      defaultSystemPrompt: defaultPrompt,
      customSystemPrompt: 'CUSTOM',
      agentSystemPrompt: 'AGENT',
      overrideSystemPrompt: 'OVERRIDE',
      appendSystemPrompt: 'should-be-ignored',
    })
    expect(result).toEqual(['OVERRIDE'])
  })

  test('appendSystemPrompt is honored alongside customSystemPrompt', () => {
    const result = buildEffectiveSystemPrompt({
      defaultSystemPrompt: defaultPrompt,
      customSystemPrompt: 'CUSTOM',
      appendSystemPrompt: 'APPEND',
    })
    expect(result).toEqual(['CUSTOM', 'APPEND'])
  })

  test('empty appendSystemPrompt is treated as absent', () => {
    const result = buildEffectiveSystemPrompt({
      defaultSystemPrompt: defaultPrompt,
      appendSystemPrompt: '   ',
    })
    expect(result).toEqual(defaultPrompt)
  })

  test('null overrideSystemPrompt does not trigger override path', () => {
    const result = buildEffectiveSystemPrompt({
      defaultSystemPrompt: defaultPrompt,
      overrideSystemPrompt: null,
    })
    expect(result).toEqual(defaultPrompt)
  })
})
