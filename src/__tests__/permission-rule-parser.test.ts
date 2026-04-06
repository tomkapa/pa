import { describe, test, expect } from 'bun:test'
import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from '../services/permissions/rule-parser.js'

describe('permissionRuleValueFromString', () => {
  test('parses tool-only rule', () => {
    expect(permissionRuleValueFromString('Read')).toEqual({
      toolName: 'Read',
    })
  })

  test('parses tool with content', () => {
    expect(permissionRuleValueFromString('Bash(git status)')).toEqual({
      toolName: 'Bash',
      ruleContent: 'git status',
    })
  })

  test('parses tool with empty content as tool-only', () => {
    expect(permissionRuleValueFromString('Bash()')).toEqual({
      toolName: 'Bash',
    })
  })

  test('parses tool with wildcard-only content as tool-only', () => {
    expect(permissionRuleValueFromString('Bash(*)')).toEqual({
      toolName: 'Bash',
    })
  })

  test('handles escaped parentheses in content', () => {
    expect(
      permissionRuleValueFromString('Bash(python -c "print\\(1\\)")'),
    ).toEqual({
      toolName: 'Bash',
      ruleContent: 'python -c "print(1)"',
    })
  })

  test('handles content with multiple escaped parens', () => {
    expect(
      permissionRuleValueFromString('Bash(echo \\(a\\) \\(b\\))'),
    ).toEqual({
      toolName: 'Bash',
      ruleContent: 'echo (a) (b)',
    })
  })

  test('parses MCP tool names', () => {
    expect(permissionRuleValueFromString('mcp__server1__tool1')).toEqual({
      toolName: 'mcp__server1__tool1',
    })
  })

  test('parses MCP server-level rule', () => {
    expect(permissionRuleValueFromString('mcp__server1')).toEqual({
      toolName: 'mcp__server1',
    })
  })

  test('parses MCP tool with content', () => {
    expect(
      permissionRuleValueFromString('mcp__server1__tool1(some content)'),
    ).toEqual({
      toolName: 'mcp__server1__tool1',
      ruleContent: 'some content',
    })
  })

  test('trims whitespace from tool name', () => {
    expect(permissionRuleValueFromString('  Read  ')).toEqual({
      toolName: 'Read',
    })
  })

  test('trims whitespace from content', () => {
    expect(permissionRuleValueFromString('Bash(  git status  )')).toEqual({
      toolName: 'Bash',
      ruleContent: 'git status',
    })
  })

  test('handles content with nested unescaped parens by finding last unescaped paren', () => {
    // "Bash(npm install)" - simple case, last ) is the closing one
    expect(permissionRuleValueFromString('Bash(npm install)')).toEqual({
      toolName: 'Bash',
      ruleContent: 'npm install',
    })
  })
})

describe('permissionRuleValueToString', () => {
  test('serializes tool-only rule', () => {
    expect(permissionRuleValueToString({ toolName: 'Read' })).toBe('Read')
  })

  test('serializes tool with content', () => {
    expect(
      permissionRuleValueToString({
        toolName: 'Bash',
        ruleContent: 'git status',
      }),
    ).toBe('Bash(git status)')
  })

  test('serializes tool with undefined content as tool-only', () => {
    expect(
      permissionRuleValueToString({ toolName: 'Bash', ruleContent: undefined }),
    ).toBe('Bash')
  })

  test('escapes parentheses in content', () => {
    expect(
      permissionRuleValueToString({
        toolName: 'Bash',
        ruleContent: 'python -c "print(1)"',
      }),
    ).toBe('Bash(python -c "print\\(1\\)")')
  })

  test('roundtrips simple rule', () => {
    const original = 'Bash(git status)'
    const parsed = permissionRuleValueFromString(original)
    expect(permissionRuleValueToString(parsed)).toBe(original)
  })

  test('roundtrips rule with escaped parens', () => {
    const original = 'Bash(python -c "print\\(1\\)")'
    const parsed = permissionRuleValueFromString(original)
    expect(permissionRuleValueToString(parsed)).toBe(original)
  })

  test('roundtrips tool-only rule', () => {
    const original = 'Read'
    const parsed = permissionRuleValueFromString(original)
    expect(permissionRuleValueToString(parsed)).toBe(original)
  })
})
