import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLSPClient } from '../lsp/client.js'
import { createLSPServerInstance } from '../lsp/server-instance.js'
import { isSupportedExtension, warmupLspServer, getLspServer } from '../lsp/manager.js'

// ---------------------------------------------------------------------------
// LSP Client — unit tests (no real language server needed)
// ---------------------------------------------------------------------------

describe('LSP client — creation', () => {
  test('initial state is not initialized', () => {
    const client = createLSPClient('test-server')
    expect(client.isInitialized).toBe(false)
    expect(client.capabilities).toBeUndefined()
    expect(client.connection).toBeUndefined()
  })

  test('stop on unstarted client is a no-op', async () => {
    const client = createLSPClient('test-server')
    // Should not throw
    await client.stop()
    expect(client.isInitialized).toBe(false)
  })

  test('sendRequest throws when not started', async () => {
    const client = createLSPClient('test-server')
    await expect(
      client.sendRequest('textDocument/hover', {}),
    ).rejects.toThrow('not started')
  })

  test('sendNotification throws when not started', async () => {
    const client = createLSPClient('test-server')
    await expect(
      client.sendNotification('textDocument/didOpen', {}),
    ).rejects.toThrow('not started')
  })

  test('initialize throws when not started', async () => {
    const client = createLSPClient('test-server')
    await expect(
      client.initialize({
        processId: 1,
        rootUri: null,
        capabilities: {},
      }),
    ).rejects.toThrow('not started')
  })

  test('start rejects with ENOENT for missing command', async () => {
    const client = createLSPClient('test-server')
    await expect(
      client.start('nonexistent-command-that-does-not-exist-12345', []),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// LSP Server Instance — basic state machine
// ---------------------------------------------------------------------------

describe('LSP server instance — basic', () => {
  test('initial state is stopped', () => {
    const instance = createLSPServerInstance('test', {
      command: 'test',
      args: [],
      extensionToLanguage: {},
    })
    expect(instance.state).toBe('stopped')
    expect(instance.isHealthy()).toBe(false)
  })

  test('stop on stopped instance is a no-op', async () => {
    const instance = createLSPServerInstance('test', {
      command: 'test',
      args: [],
      extensionToLanguage: {},
    })
    await instance.stop()
    expect(instance.state).toBe('stopped')
  })

  test('sendRequest throws when not healthy', async () => {
    const instance = createLSPServerInstance('test', {
      command: 'test',
      args: [],
      extensionToLanguage: {},
    })
    await expect(
      instance.sendRequest('test/method', {}),
    ).rejects.toThrow('not healthy')
  })

  test('concurrent start() calls dedup — all await the same in-progress promise', async () => {
    // Use a bogus command so start() fails predictably and quickly
    const instance = createLSPServerInstance('test', {
      command: 'nonexistent-command-xyz-12345',
      args: [],
      extensionToLanguage: {},
    })

    // Fire 3 concurrent starts — all should reject with the same error,
    // and state should land in 'error' (not get stuck in 'starting')
    const results = await Promise.allSettled([
      instance.start('/tmp'),
      instance.start('/tmp'),
      instance.start('/tmp'),
    ])

    expect(results.every(r => r.status === 'rejected')).toBe(true)
    expect(instance.state).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// Manager — extension support check
// ---------------------------------------------------------------------------

describe('LSP manager — warmup', () => {
  test('warmupLspServer is a no-op when cwd has no tsconfig.json', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'pa-lsp-warmup-'))
    const originalCwd = process.cwd()
    try {
      process.chdir(emptyDir)
      warmupLspServer()
      // Give any (errant) background work a moment to land
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(getLspServer()).toBeUndefined()
    } finally {
      process.chdir(originalCwd)
      await rm(emptyDir, { recursive: true, force: true })
    }
  })

  test('warmupLspServer returns synchronously (fire-and-forget)', () => {
    // Must not throw and must return void immediately
    const result = warmupLspServer()
    expect(result).toBeUndefined()
  })
})

describe('LSP manager — extension support', () => {
  test('TypeScript files are supported', () => {
    expect(isSupportedExtension('file.ts')).toBe(true)
    expect(isSupportedExtension('file.tsx')).toBe(true)
  })

  test('JavaScript files are supported', () => {
    expect(isSupportedExtension('file.js')).toBe(true)
    expect(isSupportedExtension('file.jsx')).toBe(true)
  })

  test('unsupported files return false', () => {
    expect(isSupportedExtension('file.py')).toBe(false)
    expect(isSupportedExtension('file.go')).toBe(false)
    expect(isSupportedExtension('file.rs')).toBe(false)
    expect(isSupportedExtension('Makefile')).toBe(false)
  })
})
