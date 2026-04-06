import { describe, test, expect } from 'bun:test'
import { validatePermissionRule } from '../services/permissions/rule-validation.js'

describe('validatePermissionRule', () => {
  describe('basic validation', () => {
    test('empty string is invalid', () => {
      const result = validatePermissionRule('')
      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    test('whitespace-only string is invalid', () => {
      const result = validatePermissionRule('   ')
      expect(result.valid).toBe(false)
    })

    test('valid tool-level rule passes', () => {
      expect(validatePermissionRule('Read').valid).toBe(true)
      expect(validatePermissionRule('Bash').valid).toBe(true)
      expect(validatePermissionRule('Write').valid).toBe(true)
      expect(validatePermissionRule('Edit').valid).toBe(true)
      expect(validatePermissionRule('Glob').valid).toBe(true)
      expect(validatePermissionRule('Grep').valid).toBe(true)
    })

    test('valid content-specific rule passes', () => {
      expect(validatePermissionRule('Bash(git status)').valid).toBe(true)
      expect(validatePermissionRule('Read(src/foo.ts)').valid).toBe(true)
    })
  })

  describe('parentheses validation', () => {
    test('unbalanced opening paren is invalid', () => {
      const result = validatePermissionRule('Bash(git status')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('parenthes')
    })

    test('unbalanced closing paren is invalid', () => {
      const result = validatePermissionRule('Bash git status)')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('parenthes')
    })

    test('empty parentheses warning', () => {
      const result = validatePermissionRule('Bash()')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Empty')
      expect(result.suggestion).toBeDefined()
    })
  })

  describe('tool name format', () => {
    test('lowercase tool name is invalid', () => {
      const result = validatePermissionRule('bash(test)')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('uppercase')
      expect(result.suggestion).toContain('Bash')
    })

    test('tool name must start with uppercase or be MCP format', () => {
      const result = validatePermissionRule('123tool')
      expect(result.valid).toBe(false)
    })
  })

  describe('MCP rule format', () => {
    test('valid MCP server-level rule', () => {
      expect(validatePermissionRule('mcp__server1').valid).toBe(true)
    })

    test('valid MCP tool-specific rule', () => {
      expect(validatePermissionRule('mcp__server1__tool1').valid).toBe(true)
    })

    test('MCP rule with parenthesized content is invalid', () => {
      const result = validatePermissionRule('mcp__server1(content)')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('MCP')
    })

    test('MCP prefix without double underscore is invalid', () => {
      const result = validatePermissionRule('mcp_server1')
      expect(result.valid).toBe(false)
    })
  })

  describe('tool-specific validation', () => {
    test('Bash with :* legacy prefix is valid', () => {
      expect(validatePermissionRule('Bash(npm:*)').valid).toBe(true)
    })

    test('Bash with wildcard patterns is valid', () => {
      expect(validatePermissionRule('Bash(npm *)').valid).toBe(true)
      expect(validatePermissionRule('Bash(git * main)').valid).toBe(true)
    })

    test('Bash with :* not at end is invalid', () => {
      const result = validatePermissionRule('Bash(npm:*install)')
      expect(result.valid).toBe(false)
      expect(result.error).toContain(':*')
    })

    test('WebSearch with wildcards is invalid', () => {
      const result = validatePermissionRule('WebSearch(foo *)')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('wildcard')
    })

    test('WebFetch with domain: prefix is valid', () => {
      expect(validatePermissionRule('WebFetch(domain:example.com)').valid).toBe(true)
    })

    test('WebFetch without domain: prefix is invalid', () => {
      const result = validatePermissionRule('WebFetch(https://example.com)')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('domain:')
    })

    test('file tool with glob patterns is valid', () => {
      expect(validatePermissionRule('Read(src/**/*.ts)').valid).toBe(true)
      expect(validatePermissionRule('Edit(*.json)').valid).toBe(true)
    })

    test('file tool with :* is warned', () => {
      const result = validatePermissionRule('Read(src:*)')
      expect(result.valid).toBe(false)
      expect(result.suggestion).toBeDefined()
    })
  })

  describe('known tool names', () => {
    test('known tools are valid', () => {
      const tools = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch']
      for (const tool of tools) {
        expect(validatePermissionRule(tool).valid).toBe(true)
      }
    })

    test('unknown but properly formatted tool passes (could be plugin)', () => {
      // Unknown tools should still validate if format is correct
      expect(validatePermissionRule('CustomTool').valid).toBe(true)
    })
  })

  describe('examples from acceptance criteria', () => {
    test('bash(test) returns error with suggestion', () => {
      const result = validatePermissionRule('bash(test)')
      expect(result.valid).toBe(false)
      expect(result.suggestion).toContain('Bash(test)')
    })

    test('Bash() warns about empty parentheses', () => {
      const result = validatePermissionRule('Bash()')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Empty')
      expect(result.examples).toBeDefined()
    })
  })
})
