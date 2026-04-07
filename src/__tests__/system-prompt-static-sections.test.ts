import { describe, expect, test } from 'bun:test'
import {
  getActionsSection,
  getDoingTasksSection,
  getIntroSection,
  getOutputEfficiencySection,
  getSystemSection,
  getToneSection,
  getToolGuidanceSection,
} from '../services/system-prompt/static-sections.js'

describe('getIntroSection', () => {
  test('mentions the agent name', () => {
    expect(getIntroSection()).toContain('pa')
  })
})

describe('getSystemSection', () => {
  test('starts with the System header', () => {
    expect(getSystemSection().startsWith('# System')).toBe(true)
  })
})

describe('getDoingTasksSection', () => {
  test('starts with the Doing tasks header', () => {
    expect(getDoingTasksSection().startsWith('# Doing tasks')).toBe(true)
  })
})

describe('getActionsSection', () => {
  test('mentions reversibility', () => {
    expect(getActionsSection()).toContain('reversibility')
  })
})

describe('getToneSection', () => {
  test('mentions emoji policy', () => {
    expect(getToneSection()).toContain('emoji')
  })
})

describe('getOutputEfficiencySection', () => {
  test('starts with output efficiency header', () => {
    expect(getOutputEfficiencySection().startsWith('# Output efficiency')).toBe(true)
  })
})

describe('getToolGuidanceSection', () => {
  test('returns null when no tools are enabled', () => {
    expect(getToolGuidanceSection(new Set())).toBeNull()
  })

  test('only mentions enabled tools', () => {
    const out = getToolGuidanceSection(new Set(['Read', 'Edit']))
    expect(out).not.toBeNull()
    expect(out!).toContain('Read')
    expect(out!).toContain('Edit')
    expect(out!).not.toContain('Write')
    expect(out!).not.toContain('Glob')
    expect(out!).not.toContain('Grep')
  })

  test('mentions Bash hint only when Bash is enabled', () => {
    const withBash = getToolGuidanceSection(new Set(['Bash']))
    expect(withBash!).toContain('Bash')

    const withoutBash = getToolGuidanceSection(new Set(['Read']))
    // Without Bash, the section should not push the "reserve Bash" hint.
    expect(withoutBash!).not.toContain('Reserve Bash')
  })

  test('always mentions parallel execution guidance', () => {
    const out = getToolGuidanceSection(new Set(['Read']))
    expect(out!).toContain('parallel')
  })
})
