import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isNodeError } from '../../utils/error.js'
import { envFlag } from './state.js'

/**
 * VCR — record/replay API responses for deterministic test runs.
 *
 * Goal: a test that calls into the agent must always see the same bytes from
 * the model. The first run records to disk, every subsequent run replays.
 * Changing the input changes the fixture hash, so prompt/tool changes are
 * forced into PR diffs as new fixture files.
 */

/** Default fixture root, relative to cwd. Override with `VCR_FIXTURES_DIR`. */
const DEFAULT_FIXTURES_DIR = 'fixtures/vcr'

function fixturesDir(): string {
  return process.env['VCR_FIXTURES_DIR'] ?? DEFAULT_FIXTURES_DIR
}

function isCI(): boolean {
  return envFlag('CI') === true
}

function isRecordMode(): boolean {
  return envFlag('VCR_RECORD') === true
}

/**
 * Whether VCR should intercept this call. Active in test environments and
 * whenever someone explicitly opts in (e.g. for ad-hoc fixture refreshes).
 */
export function shouldUseVCR(): boolean {
  if (isRecordMode()) return true
  if (envFlag('VCR_DISABLED') === true) return false
  return process.env['NODE_ENV'] === 'test'
}

/**
 * Replace per-run-varying values (absolute paths, session ids, timestamps,
 * randomized ids) with stable placeholders. Both the recording and replay
 * paths apply this so the resulting fixture hash is reproducible across
 * machines and runs.
 */
export function normalizeMessagesForVCR(input: unknown): unknown {
  return normalizeValue(input)
}

const cwd = process.cwd()
const home = process.env['HOME'] ?? ''
const ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const REQ_ID_RE = /req_[a-zA-Z0-9]+/g
const MSG_ID_RE = /msg_[a-zA-Z0-9]+/g

function normalizeString(s: string): string {
  let out = s
  if (cwd && out.includes(cwd)) out = out.split(cwd).join('<CWD>')
  if (home && out.includes(home)) out = out.split(home).join('<HOME>')
  out = out.replace(ISO_TIMESTAMP_RE, '<TIMESTAMP>')
  out = out.replace(UUID_RE, '<UUID>')
  out = out.replace(REQ_ID_RE, '<REQ_ID>')
  out = out.replace(MSG_ID_RE, '<MSG_ID>')
  return out
}

function normalizeValue(value: unknown): unknown {
  if (value === null) return null
  if (typeof value === 'string') return normalizeString(value)
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(normalizeValue)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = normalizeValue(v)
  }
  return out
}

function fixtureHash(input: unknown): string {
  const normalized = normalizeMessagesForVCR(input)
  return createHash('sha1').update(JSON.stringify(normalized)).digest('hex').slice(0, 12)
}

function fixturePath(name: string, input: unknown): string {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(fixturesDir(), `${safeName}-${fixtureHash(input)}.json`)
}

function readFixture(path: string): unknown | null {
  try {
    const text = readFileSync(path, 'utf8')
    return JSON.parse(text) as unknown
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return null
    throw err
  }
}

function writeFixture(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function missingFixtureError(path: string): Error {
  return new Error(
    `Fixture missing: ${path}. Re-run tests with VCR_RECORD=1 and commit the result.`,
  )
}

/**
 * Wrap an async API call with deterministic record/replay. The first run
 * (with no fixture present) records the result and writes it to disk. Every
 * subsequent run reads it from disk without invoking `fn`.
 *
 * In CI, missing fixtures are a hard error — see `missingFixtureError`.
 */
export async function withVCR<T>(
  input: unknown,
  fixtureName: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!shouldUseVCR()) return fn()

  const path = fixturePath(fixtureName, input)
  if (existsSync(path) && !isRecordMode()) {
    const cached = readFixture(path)
    if (cached !== null) return cached as T
  }

  if (isCI() && !isRecordMode()) {
    throw missingFixtureError(path)
  }

  const result = await fn()
  writeFixture(path, result)
  return result
}

/**
 * Streaming variant of `withVCR`. SSE-style async iterables don't fit the
 * scalar `withVCR` shape because the consumer wants to iterate one chunk at
 * a time. We collect on first run and yield from disk on replay.
 *
 * On replay, chunks are yielded with no artificial delay — tests want
 * determinism, not realism.
 */
export async function* withStreamingVCR<T>(
  input: unknown,
  fixtureName: string,
  fn: () => AsyncIterable<T>,
): AsyncGenerator<T> {
  if (!shouldUseVCR()) {
    for await (const chunk of fn()) yield chunk
    return
  }

  const path = fixturePath(fixtureName, input)
  if (existsSync(path) && !isRecordMode()) {
    const cached = readFixture(path) as { chunks: T[] } | null
    if (cached && Array.isArray(cached.chunks)) {
      for (const chunk of cached.chunks) yield chunk
      return
    }
  }

  if (isCI() && !isRecordMode()) {
    throw missingFixtureError(path)
  }

  const collected: T[] = []
  for await (const chunk of fn()) {
    collected.push(chunk)
    yield chunk
  }
  writeFixture(path, { chunks: collected })
}
