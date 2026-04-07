import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  __resetDebugLoggerForTests,
  flushDebugLogSync,
  getDebugLogPath,
  logForDebugging,
} from '../services/observability/debug.js'
import { getSessionId } from '../services/observability/state.js'
import { snapshotEnv } from '../testing/env-snapshot.js'

let tmp: string
let restoreEnv: () => void

beforeEach(() => {
  restoreEnv = snapshotEnv(['PA_HOME', 'PA_DEBUG', 'NODE_ENV'])
  tmp = mkdtempSync(join(tmpdir(), 'pa-debug-test-'))
  process.env['PA_HOME'] = tmp
  process.env['PA_DEBUG'] = '1'
  __resetDebugLoggerForTests()
})

afterEach(() => {
  __resetDebugLoggerForTests()
  rmSync(tmp, { recursive: true, force: true })
  restoreEnv()
})

describe('observability/debug', () => {
  test('writes a line to ~/.pa/debug/<sessionId>.txt', () => {
    logForDebugging('hello world', { level: 'info' })
    flushDebugLogSync()

    const expectedPath = join(tmp, 'debug', `${getSessionId()}.txt`)
    expect(existsSync(expectedPath)).toBe(true)
    const content = readFileSync(expectedPath, 'utf8')
    expect(content).toContain('[info] hello world')
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
  })

  test('refreshes a `latest` symlink to the current session file', () => {
    logForDebugging('first')
    flushDebugLogSync()

    const latest = join(tmp, 'debug', 'latest')
    const stat = lstatSync(latest)
    expect(stat.isSymbolicLink()).toBe(true)
    expect(readlinkSync(latest)).toBe(join(tmp, 'debug', `${getSessionId()}.txt`))
  })

  test('logForDebugging is fire-and-forget (returns void)', () => {
    const result = logForDebugging('void check') as unknown
    expect(result).toBeUndefined()
  })

  test('disabled in production unless PA_DEBUG=1', () => {
    __resetDebugLoggerForTests()
    process.env['NODE_ENV'] = 'production'
    delete process.env['PA_DEBUG']
    logForDebugging('should not write')
    flushDebugLogSync()
    expect(getDebugLogPath()).toBe('')
    // afterEach restores NODE_ENV — no need for an inline finally.
  })

  test('default level is `debug`', () => {
    logForDebugging('no opts')
    flushDebugLogSync()
    const content = readFileSync(getDebugLogPath(), 'utf8')
    expect(content).toContain('[debug] no opts')
  })
})
