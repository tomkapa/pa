import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadMcpConfig } from '../services/mcp/config.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let testDir: string

beforeEach(() => {
  testDir = join(tmpdir(), `pa-mcp-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// loadMcpConfig
// ---------------------------------------------------------------------------

describe('loadMcpConfig', () => {
  test('returns null when mcp.json does not exist', async () => {
    const result = await loadMcpConfig(testDir)
    expect(result).toBeNull()
  })

  test('parses valid config with one stdio server', async () => {
    writeFileSync(join(testDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        fs: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
      },
    }))

    const result = await loadMcpConfig(testDir)
    expect(result).not.toBeNull()
    expect(result!.mcpServers.fs).toBeDefined()
    expect(result!.mcpServers.fs!.command).toBe('npx')
    expect(result!.mcpServers.fs!.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp'])
  })

  test('parses config with multiple servers', async () => {
    writeFileSync(join(testDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        fs: { command: 'npx', args: ['server-fs'] },
        git: { command: 'npx', args: ['server-git'] },
      },
    }))

    const result = await loadMcpConfig(testDir)
    expect(result).not.toBeNull()
    expect(Object.keys(result!.mcpServers)).toEqual(['fs', 'git'])
  })

  test('parses config with optional env field', async () => {
    writeFileSync(join(testDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        fs: {
          command: 'npx',
          args: [],
          env: { FOO: 'bar', BAZ: 'qux' },
        },
      },
    }))

    const result = await loadMcpConfig(testDir)
    expect(result!.mcpServers.fs!.env).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  test('parses config with explicit stdio type', async () => {
    writeFileSync(join(testDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        fs: { type: 'stdio', command: 'npx', args: [] },
      },
    }))

    const result = await loadMcpConfig(testDir)
    expect(result!.mcpServers.fs!.type).toBe('stdio')
  })

  test('defaults args to empty array when omitted', async () => {
    writeFileSync(join(testDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        fs: { command: 'echo' },
      },
    }))

    const result = await loadMcpConfig(testDir)
    expect(result!.mcpServers.fs!.args).toEqual([])
  })

  test('throws on invalid JSON', async () => {
    writeFileSync(join(testDir, 'mcp.json'), '{not valid json}')

    await expect(loadMcpConfig(testDir)).rejects.toThrow('not valid JSON')
  })

  test('throws on schema validation failure — missing command', async () => {
    writeFileSync(join(testDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        fs: { args: ['foo'] },
      },
    }))

    await expect(loadMcpConfig(testDir)).rejects.toThrow('Invalid MCP config')
  })

  test('throws on schema validation failure — empty command', async () => {
    writeFileSync(join(testDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        fs: { command: '' },
      },
    }))

    await expect(loadMcpConfig(testDir)).rejects.toThrow('Invalid MCP config')
  })

  test('handles empty mcpServers object', async () => {
    writeFileSync(join(testDir, 'mcp.json'), JSON.stringify({
      mcpServers: {},
    }))

    const result = await loadMcpConfig(testDir)
    expect(result).not.toBeNull()
    expect(Object.keys(result!.mcpServers)).toHaveLength(0)
  })
})
