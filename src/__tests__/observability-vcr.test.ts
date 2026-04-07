import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withStreamingVCR, withVCR } from '../services/observability/vcr.js'
import { snapshotEnv } from '../testing/env-snapshot.js'

let tmp: string
let restoreEnv: () => void

beforeEach(() => {
  restoreEnv = snapshotEnv(['CI', 'VCR_RECORD', 'VCR_FIXTURES_DIR', 'NODE_ENV'])
  tmp = mkdtempSync(join(tmpdir(), 'pa-vcr-test-'))
  process.env['VCR_FIXTURES_DIR'] = tmp
  process.env['NODE_ENV'] = 'test'
  delete process.env['CI']
  delete process.env['VCR_RECORD']
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  restoreEnv()
})

describe('observability/vcr', () => {
  test('records on first run, replays on second run without invoking fn', async () => {
    let calls = 0
    const fn = async () => {
      calls++
      return { reply: 'first' }
    }

    const a = await withVCR({ prompt: 'hi' }, 'simple', fn)
    expect(a).toEqual({ reply: 'first' })
    expect(calls).toBe(1)

    const b = await withVCR({ prompt: 'hi' }, 'simple', fn)
    expect(b).toEqual({ reply: 'first' })
    expect(calls).toBe(1) // not incremented — replayed
  })

  test('changing input changes the fixture path (new recording)', async () => {
    let calls = 0
    const fn = async () => {
      calls++
      return { call: calls }
    }

    await withVCR({ prompt: 'hi' }, 'change', fn)
    await withVCR({ prompt: 'bye' }, 'change', fn)
    expect(calls).toBe(2)
  })

  test('CI without VCR_RECORD throws when fixture missing', async () => {
    process.env['CI'] = '1'
    const fn = async () => ({ should: 'never run' })

    await expect(withVCR({ prompt: 'absent' }, 'ci-test', fn)).rejects.toThrow(
      /Fixture missing:.*Re-run tests with VCR_RECORD=1/,
    )
  })

  test('VCR_RECORD=1 forces re-record even when fixture exists', async () => {
    let calls = 0
    const fn = async () => {
      calls++
      return { v: calls }
    }

    await withVCR({ x: 1 }, 'record-mode', fn)
    expect(calls).toBe(1)

    process.env['VCR_RECORD'] = '1'
    await withVCR({ x: 1 }, 'record-mode', fn)
    expect(calls).toBe(2)
  })

  test('streaming VCR records chunks then replays them in order', async () => {
    let calls = 0
    async function* gen() {
      calls++
      yield { i: 1 }
      yield { i: 2 }
      yield { i: 3 }
    }

    const out1: Array<{ i: number }> = []
    for await (const c of withStreamingVCR({ q: 's' }, 'stream', () => gen())) {
      out1.push(c)
    }
    expect(out1).toEqual([{ i: 1 }, { i: 2 }, { i: 3 }])
    expect(calls).toBe(1)

    const out2: Array<{ i: number }> = []
    for await (const c of withStreamingVCR({ q: 's' }, 'stream', () => gen())) {
      out2.push(c)
    }
    expect(out2).toEqual([{ i: 1 }, { i: 2 }, { i: 3 }])
    expect(calls).toBe(1) // replayed, generator not invoked
  })

  test('streaming VCR throws on missing fixture in CI', async () => {
    process.env['CI'] = '1'
    async function* gen() {
      yield { never: true }
    }

    let err: unknown
    try {
      for await (const _ of withStreamingVCR({ q: 'absent' }, 'stream-ci', () => gen())) {
        // unreachable
      }
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/Fixture missing:/)
  })

  test('input normalization makes hash stable across paths/timestamps', async () => {
    const inputA = {
      ts: '2026-04-07T10:11:12.123Z',
      path: process.cwd() + '/some/file.ts',
      id: 'msg_abc123def',
    }
    const inputB = {
      ts: '2099-12-31T23:59:59.999Z',
      path: process.cwd() + '/some/file.ts',
      id: 'msg_zzz999yyy',
    }

    let calls = 0
    const fn = async () => {
      calls++
      return { ok: true }
    }

    await withVCR(inputA, 'norm', fn)
    await withVCR(inputB, 'norm', fn)
    // Same fixture: both inputs normalize to identical hashes.
    expect(calls).toBe(1)
  })

  test('shouldUseVCR is false outside test mode (no fixture written)', async () => {
    delete process.env['NODE_ENV']
    let calls = 0
    const fn = async () => {
      calls++
      return { ok: true }
    }

    await withVCR({ x: 1 }, 'no-vcr', fn)
    await withVCR({ x: 1 }, 'no-vcr', fn)
    // Without VCR active, fn runs every time.
    expect(calls).toBe(2)
  })
})
